// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {GameManager} from "../src/GameManager.sol";

contract Deploy is Script {
    function run() external {
        address owner = 0x6789e51196Ea26A159C992B70CC80453Ca6E381a;
        vm.startBroadcast();
        GameManager gm = new GameManager(owner);
        vm.stopBroadcast();
    }
}
