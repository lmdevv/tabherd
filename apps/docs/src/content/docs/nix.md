---
title: Nix and NixOS
description: Run Tabherd with nix run, or register it declaratively with the NixOS or Home Manager module.
---

The repository is a flake. It provides the CLI, a NixOS module and a Home Manager module. With a module, the browser registration is part of your configuration, so you never run `tabherd setup`. Upgrades and garbage collection can't break the registration.

You still load the extension yourself, as in the [quick start](../quick-start/#2-load-the-extension).

## Try it

```sh
nix run github:lmdevv/tabherd -- --help
nix run github:lmdevv/tabherd -- status
```

This needs a registered browser to do anything useful. For a quick test without a module, install the package into your profile and register it:

```sh
nix profile add github:lmdevv/tabherd
tabherd setup
```

On older Nix, the command is `nix profile install`. Setup writes the package's current store path into the browser registration. Run `tabherd setup` again after every `nix profile upgrade`, or use a module instead.

## NixOS

Add the flake to your inputs and import the module:

```nix
{
  inputs.tabherd.url = "github:lmdevv/tabherd";

  outputs = { nixpkgs, tabherd, ... }: {
    nixosConfigurations.my-machine = nixpkgs.lib.nixosSystem {
      modules = [
        ./configuration.nix
        tabherd.nixosModules.default
        { programs.tabherd.enable = true; }
      ];
    };
  };
}
```

The module installs `tabherd` for every user. It registers the native host machine-wide for Chrome, Chromium, Brave and Edge in `/etc`. Brave reads Chrome's registration. For Firefox it uses `programs.firefox.nativeMessagingHosts.packages`, which covers a Firefox installed with `programs.firefox.enable`.

## Home Manager

```nix
{
  inputs.tabherd.url = "github:lmdevv/tabherd";

  outputs = { nixpkgs, home-manager, tabherd, ... }: {
    homeConfigurations.me = home-manager.lib.homeManagerConfiguration {
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      modules = [
        tabherd.homeModules.default
        { programs.tabherd.enable = true; }
      ];
    };
  };
}
```

The Home Manager module writes the registration into each browser's per-user folder. It works on Linux and macOS, with or without NixOS, and alongside Home Manager's own `programs.firefox`.

## Options

Both modules share these options:

| Option                          | Default                                          | Meaning                                                                                                            |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `programs.tabherd.enable`       | `false`                                          | Install the CLI and register the native host.                                                                      |
| `programs.tabherd.browsers`     | `["chrome" "chromium" "brave" "edge" "firefox"]` | Browsers to register. Registering a browser you don't have is harmless.                                            |
| `programs.tabherd.extensionIds` | `[]`                                             | Extra Chromium extension IDs to allow, such as a build without the manifest key. The release ID is always allowed. |
| `programs.tabherd.package`      | this flake's package                             | The package the browsers launch.                                                                                   |

The flake also has `overlays.default`, which adds `pkgs.tabherd`.

## Add MCP to your agent

The module puts `tabherd` on your `PATH`, so the usual configuration works:

```json
{ "mcpServers": { "tabherd": { "command": "tabherd", "args": ["mcp"] } } }
```

If your agent's configuration is also managed by Nix, you can use the store path instead: `"${pkgs.tabherd}/bin/tabherd"` with the overlay, or `"${tabherd.packages.${system}.default}/bin/tabherd"`.

## Check it

```sh
tabherd doctor
```

`doctor` also accepts registrations made by the modules. If you used `tabherd setup` before switching to a module, run `tabherd uninstall` first. Otherwise browsers keep preferring the old per-user registration, and Home Manager refuses to replace the file it left behind.

The flake builds with its own pinned nixpkgs. If you set `inputs.tabherd.inputs.nixpkgs.follows = "nixpkgs"`, use a recent nixos-unstable.
