# Options shared by the NixOS and Home Manager modules.
{ lib, defaultPackage }:
{
  enable = lib.mkEnableOption "Tabherd, the bridge between the Tabherd browser extension and your agents";
  package = lib.mkOption {
    type = lib.types.package;
    default = defaultPackage;
    defaultText = lib.literalExpression "tabherd.packages.\${system}.default";
    description = "The Tabherd package. Its CLI is installed and browsers launch its native host.";
  };
  browsers = lib.mkOption {
    type = lib.types.listOf (
      lib.types.enum [
        "chrome"
        "chromium"
        "brave"
        "edge"
        "firefox"
      ]
    );
    default = [
      "chrome"
      "chromium"
      "brave"
      "edge"
      "firefox"
    ];
    description = "Browsers to register the native messaging host for. Registering a browser that is not installed is harmless.";
  };
  extensionIds = lib.mkOption {
    type = lib.types.listOf (lib.types.strMatching "[a-p]{32}");
    default = [ ];
    example = [ "abcdefghijklmnopabcdefghijklmnop" ];
    description = ''
      Extra Chromium extension IDs allowed to connect, for example a copy built without the
      manifest key. The ID of the released extension is always allowed.
    '';
  };
}
