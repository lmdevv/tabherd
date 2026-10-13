{
  self,
  nixpkgs,
  pkgs,
}:
let
  inherit (pkgs) lib;
  system = pkgs.stdenv.hostPlatform.system;
  tabherd = self.packages.${system}.default;
  extraId = "abcdefghijklmnopabcdefghijklmnop";
  releaseOrigin = "chrome-extension://hepgdbeccdmbongocnnamapillglcbgk/";

  # Home Manager is not an input; these stand-in options are the two the module sets.
  home = lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      self.homeModules.default
      {
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; };
        options.home.file = lib.mkOption {
          type = lib.types.attrsOf (
            lib.types.submodule { options.text = lib.mkOption { type = lib.types.str; }; }
          );
        };
        config.programs.tabherd = {
          enable = true;
          extensionIds = [ extraId ];
        };
      }
    ];
  };
  inherit
    (import ./manifests.nix {
      inherit lib;
      launcher = "";
      isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
    })
    userDirectories
    ;
  parse = text: builtins.fromJSON (builtins.unsafeDiscardStringContext text);
  homeFiles = lib.mapAttrs (_: file: parse file.text) home.config.home.file;
  firefoxDir =
    if pkgs.stdenv.hostPlatform.isDarwin then
      "Library/Application Support/Mozilla/NativeMessagingHosts"
    else
      ".mozilla/native-messaging-hosts";
  homeFirefox = homeFiles."${firefoxDir}/com.tabherd.bridge.json";
  homeChromes = lib.filterAttrs (name: _: !(lib.hasPrefix firefoxDir name)) homeFiles;
in
{
  package = tabherd;

  # The packaged manifests must match tabherd setup, and doctor must accept them.
  manifests =
    pkgs.runCommand "tabherd-manifests-check"
      {
        nativeBuildInputs = [
          tabherd
          pkgs.jq
        ];
      }
      ''
        export HOME=$TMPDIR/home TABHERD_STATE_DIR=$TMPDIR/state
        for browser in chromium firefox; do
          tabherd setup --browser $browser --manifest-dir $TMPDIR/$browser > /dev/null
        done
        rm -r $TMPDIR/state
        check() {
          diff <(jq -S 'del(.path)' $TMPDIR/$1/com.tabherd.bridge.json) <(jq -S 'del(.path)' $2)
          [ "$(jq -r .path $2)" = ${tabherd}/libexec/tabherd/native-host ]
        }
        check chromium ${tabherd}/etc/chromium/native-messaging-hosts/com.tabherd.bridge.json
        check chromium ${tabherd}/etc/opt/chrome/native-messaging-hosts/com.tabherd.bridge.json
        check firefox ${tabherd}/lib/mozilla/native-messaging-hosts/com.tabherd.bridge.json
        test -x ${tabherd}/libexec/tabherd/native-host

        mkdir -p "$HOME/${userDirectories.chromium}"
        cp ${tabherd}/etc/chromium/native-messaging-hosts/com.tabherd.bridge.json "$HOME/${userDirectories.chromium}/"
        tabherd doctor > report.json || true
        # Everything but the live browser connection passes.
        jq -e '[.checks[] | select(.ok | not) | .name] == ["browser connection"]' report.json
        touch $out
      '';

  home-module =
    assert lib.elem tabherd home.config.home.packages;
    # Chrome, Chromium and Edge; Brave reads Chrome's file.
    assert lib.length (lib.attrNames homeChromes) == 3;
    assert lib.all (
      manifest:
      manifest.allowed_origins == [
        releaseOrigin
        "chrome-extension://${extraId}/"
      ]
      && manifest.path == "${tabherd}/libexec/tabherd/native-host"
    ) (lib.attrValues homeChromes);
    assert homeFirefox.allowed_extensions == [ "tabherd@local" ];
    pkgs.emptyFile;
}
// lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
  nixos-module =
    let
      nixos = nixpkgs.lib.nixosSystem {
        modules = [
          self.nixosModules.default
          {
            nixpkgs.hostPlatform = system;
            boot.isContainer = true;
            system.stateVersion = "26.05";
            programs.tabherd = {
              enable = true;
              browsers = [
                "brave"
                "firefox"
              ];
              extensionIds = [ extraId ];
            };
          }
        ];
      };
      inherit (nixos.config.environment) etc;
      manifest = path: parse etc."${path}/com.tabherd.bridge.json".text;
      # Brave alone registers in Chrome's directory, which is the one it reads.
      chrome = manifest "opt/chrome/native-messaging-hosts";
    in
    assert lib.elem tabherd nixos.config.environment.systemPackages;
    assert
      chrome.allowed_origins == [
        releaseOrigin
        "chrome-extension://${extraId}/"
      ];
    assert chrome.path == "${tabherd}/libexec/tabherd/native-host";
    assert !(etc ? "chromium/native-messaging-hosts/com.tabherd.bridge.json");
    assert lib.elem tabherd nixos.config.programs.firefox.nativeMessagingHosts.packages;
    pkgs.emptyFile;
}
