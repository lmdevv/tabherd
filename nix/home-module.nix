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
    isDarwin = pkgs.stdenv.hostPlatform.isDarwin;
  };
in
{
  options.programs.tabherd = import ./options.nix {
    inherit lib;
    defaultPackage = defaultPackage pkgs;
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
    # Brave shares Chrome's directory, so register each directory once.
    home.file = lib.listToAttrs (
      map (browser: {
        name = "${manifests.userDirectories.${browser}}/${manifests.file}";
        value.text = if browser == "firefox" then manifests.firefox else manifests.chromium;
      }) (lib.unique (map (browser: if browser == "brave" then "chrome" else browser) cfg.browsers))
    );
  };
}
