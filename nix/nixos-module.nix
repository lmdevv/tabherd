# Registers the native messaging host machine-wide, for every user.
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
  };
  chromiumBrowsers = lib.filter (browser: browser != "firefox") cfg.browsers;
in
{
  options.programs.tabherd = import ./options.nix {
    inherit lib;
    defaultPackage = defaultPackage pkgs;
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];
    environment.etc = lib.listToAttrs (
      map (browser: {
        name = "${manifests.etcDirectories.${browser}}/${manifests.file}";
        value.text = manifests.chromium;
      }) chromiumBrowsers
    );
    # Firefox reads no machine-wide directory on NixOS; its wrapper links these for each user.
    programs.firefox.nativeMessagingHosts.packages = lib.mkIf (lib.elem "firefox" cfg.browsers) [
      cfg.package
    ];
  };
}
