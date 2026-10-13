# Registers the native messaging host for one user, on Linux and macOS.
defaultPackage:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.tabherd;
  manifests = import ./manifests.nix {
    inherit lib;
    inherit (cfg) extensionIds;
    launcher = "${cfg.package}/libexec/tabherd/native-host";
    inherit isDarwin;
  };
  inherit (pkgs.stdenv.hostPlatform) isDarwin;
  inConfig = lib.filter (browser: !isDarwin && browser != "firefox") cfg.browsers;
  inHome = lib.subtractLists inConfig cfg.browsers;
  # Brave shares Chrome's directory, so register each directory once.
  onePerDirectory = browsers: lib.unique (map (b: if b == "brave" then "chrome" else b) browsers);
in
{
  options.programs.tabherd = import ./options.nix {
    inherit lib;
    defaultPackage = defaultPackage pkgs;
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
    home.file = lib.listToAttrs (
      map (browser: {
        name = "${manifests.userDirectories.${browser}}/${manifests.file}";
        value.text = if browser == "firefox" then manifests.firefox else manifests.chromium;
      }) (onePerDirectory inHome)
    );
    # Linux Chromium browsers look under xdg.configHome, which may be outside ~/.config.
    xdg.configFile = lib.listToAttrs (
      map (browser: {
        name = "${manifests.configDirectories.${browser}}/${manifests.file}";
        value.text = manifests.chromium;
      }) (onePerDirectory inConfig)
    );
  };
}
