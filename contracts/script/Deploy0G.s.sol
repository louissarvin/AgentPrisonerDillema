// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GameManager} from "../src/GameManager.sol";
import {TournamentManager} from "../src/TournamentManager.sol";

/// @title Deploy0G
/// @notice Deploys GameManager and TournamentManager to 0G Galileo Testnet (chain 16602)
/// @dev Run: forge script script/Deploy0G.s.sol:Deploy0G --rpc-url https://evmrpc-testnet.0g.ai --broadcast --verify --verifier custom --verifier-api-key "PLACEHOLDER" --verifier-url https://chainscan-galileo.0g.ai/open/api
contract Deploy0G is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying to 0G Galileo Testnet (chain 16602)");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy GameManager
        GameManager gameManager = new GameManager(deployer);
        console.log("GameManager deployed at:", address(gameManager));

        // Deploy TournamentManager with GameManager address
        TournamentManager tournamentManager = new TournamentManager(deployer, address(gameManager));
        console.log("TournamentManager deployed at:", address(tournamentManager));

        vm.stopBroadcast();

        // Log deployment summary
        console.log("---");
        console.log("DEPLOYMENT SUMMARY (0G Galileo):");
        console.log("  GameManager:", address(gameManager));
        console.log("  TournamentManager:", address(tournamentManager));
        console.log("  Owner/Operator:", deployer);
    }
}
