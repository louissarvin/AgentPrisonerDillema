// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BettingPool} from "../src/BettingPool.sol";

/// @title DeployUnichain
/// @notice Deploys BettingPool to Unichain Sepolia (chain 1301)
/// @dev Run: forge script script/DeployUnichain.s.sol:DeployUnichain --rpc-url https://sepolia.unichain.org --broadcast
contract DeployUnichain is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address oracle = vm.envOr("ORACLE_ADDRESS", deployer);

        console.log("Deploying to Unichain Sepolia (chain 1301)");
        console.log("Deployer:", deployer);
        console.log("Oracle:", oracle);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy BettingPool with deployer as owner and oracle
        BettingPool bettingPool = new BettingPool(deployer, oracle);
        console.log("BettingPool deployed at:", address(bettingPool));

        vm.stopBroadcast();

        // Log deployment summary
        console.log("---");
        console.log("DEPLOYMENT SUMMARY (Unichain Sepolia):");
        console.log("  BettingPool:", address(bettingPool));
        console.log("  Owner:", deployer);
        console.log("  Oracle:", oracle);
        console.log("  USDC:", address(bettingPool.USDC()));
    }
}

