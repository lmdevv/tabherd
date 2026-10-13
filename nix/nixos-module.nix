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
    # Brave shares Chrome's directory, so register each directory once.
    environment.etc = lib.listToAttrs (
      map (directory: {
        name = "${directory}/${manifests.file}";
        value.text = manifests.chromium;
      }) (lib.unique (map (browser: manifests.etcDirectories.${browser}) chromiumBrowsers))
    );
    # NixOS has no machine-wide Firefox directory; the Firefox wrapper points MOZ_SYSTEM_DIR
    # at the hosts of these packages.
    programs.firefox.nativeMessagingHosts.packages = lib.mkIf (lib.elem "firefox" cfg.browsers) [
      cfg.package
    ];
  };
}
