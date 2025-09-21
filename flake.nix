{
  description = "RSS Feed Worker with Nix-managed dependencies";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";
    flake-utils.url = "github:numtide/flake-utils";
    npmlock2nix = {
      url = "github:nix-community/npmlock2nix";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, npmlock2nix }:
    flake-utils.lib.eachSystem [
      "x86_64-linux"
      "aarch64-linux"
      "x86_64-darwin"
      "aarch64-darwin"
    ] (system:
      let
        pkgs = import nixpkgs { inherit system; };
        n2n = import npmlock2nix { inherit pkgs; };
        nodeModules = n2n.v2.node_modules {
          src = ./.;
          nodejs = pkgs.nodejs_20;
        };
      in {
        packages = {
          default = nodeModules;
          nodeModules = nodeModules;
        };

        devShells.default =
          n2n.v2.shell {
            src = ./.;
            nodejs = pkgs.nodejs_20;
            node_modules_attrs = {
              nodejs = pkgs.nodejs_20;
            };
            buildInputs = with pkgs; [
              nodejs_20
              git
            ];
            shellHook = ''
              export PATH="$PWD/node_modules/.bin:$PATH"
            '';
          };
      });
}
