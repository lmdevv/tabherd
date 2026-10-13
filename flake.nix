{
  description = "Tabherd: your browser, connected to your agent";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # Modules default to the package built with this flake's pinned nixpkgs, or with the
      # user's nixpkgs on a system this flake doesn't list (such as x86_64-darwin).
      defaultPackage =
        pkgs:
        self.packages.${pkgs.stdenv.hostPlatform.system}.default
          or (pkgs.callPackage ./nix/package.nix { });
    in
    {
      packages = forAllSystems (pkgs: rec {
        tabherd = pkgs.callPackage ./nix/package.nix { };
        default = tabherd;
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          meta.description = "Tabherd CLI and MCP server";
        };
      });

      overlays.default = final: _prev: { tabherd = final.callPackage ./nix/package.nix { }; };

      nixosModules.default = import ./nix/nixos-module.nix defaultPackage;
      homeModules.default = import ./nix/home-module.nix defaultPackage;
      # The name older Home Manager documentation uses.
      homeManagerModules.default = self.homeModules.default;

      checks = forAllSystems (pkgs: import ./nix/checks.nix { inherit self nixpkgs pkgs; });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs
            pkgs.pnpm
          ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
