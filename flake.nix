{
  description = "Torsel, data as tables and interfaces as views, packaged as a NixOS service";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs, ... }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in
    {
      packages.x86_64-linux = rec {
        torsel = pkgs.callPackage ./nix/package.nix { };
        default = torsel;
      };

      nixosModules = rec {
        torsel = import ./nix/module.nix { inherit self; };
        default = torsel;
      };
    };
}
