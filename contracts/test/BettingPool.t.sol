// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {BettingPool} from "../src/BettingPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock USDC with 6 decimals for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title BettingPool Test Suite
/// @notice Comprehensive tests covering all BettingPool functionality
contract BettingPoolTest is Test {
    BettingPool public pool;
    MockUSDC public mockUsdc;

    address public owner = makeAddr("owner");
    address public oracle = makeAddr("oracle");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");
    address public attacker = makeAddr("attacker");

    // Commonly used constants
    uint256 constant MATCH_ID = 1;
    uint256 constant ROUND_NUM = 1;
    uint256 constant ONE_USDC = 1e6;
    uint256 constant HUNDRED_USDC = 100e6;
    uint256 constant THOUSAND_USDC = 1000e6;

    // The hardcoded USDC address in BettingPool
    address constant USDC_ADDRESS = 0x31d0220469e10c4E71834a79b1f276d740d3768F;

    function setUp() public {
        // Deploy MockUSDC and place its bytecode at the hardcoded USDC address
        mockUsdc = new MockUSDC();
        vm.etch(USDC_ADDRESS, address(mockUsdc).code);

        // Deploy the BettingPool
        pool = new BettingPool(owner, oracle);

        // Mint USDC to test users
        _mintUsdc(alice, 100_000e6);
        _mintUsdc(bob, 100_000e6);
        _mintUsdc(charlie, 100_000e6);

        // Approve pool for all test users
        vm.prank(alice);
        IERC20(USDC_ADDRESS).approve(address(pool), type(uint256).max);
        vm.prank(bob);
        IERC20(USDC_ADDRESS).approve(address(pool), type(uint256).max);
        vm.prank(charlie);
        IERC20(USDC_ADDRESS).approve(address(pool), type(uint256).max);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────────

    function _mintUsdc(address to, uint256 amount) internal {
        // Directly set storage for the mock at the hardcoded address
        deal(USDC_ADDRESS, to, amount);
    }

    function _openRound(uint256 matchId, uint256 roundNumber, uint256 deadline) internal {
        vm.prank(oracle);
        pool.openBettingRound(matchId, roundNumber, deadline);
    }

    function _openDefaultRound() internal {
        _openRound(MATCH_ID, ROUND_NUM, block.timestamp + 1 hours);
    }

    function _placeBet(address bettor, uint256 matchId, uint256 roundNumber, BettingPool.Outcome prediction, uint256 amount) internal {
        vm.prank(bettor);
        pool.placeBet(matchId, roundNumber, prediction, amount);
    }

    function _settleRound(uint256 matchId, uint256 roundNumber, BettingPool.Outcome outcome) internal {
        vm.prank(oracle);
        pool.settleBettingRound(matchId, roundNumber, outcome);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 1. OPENING BETTING ROUNDS
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_openBettingRound_happyPath() public {
        uint256 deadline = block.timestamp + 1 hours;

        vm.expectEmit(true, true, false, true);
        emit BettingPool.BettingRoundOpened(MATCH_ID, ROUND_NUM, deadline);

        _openRound(MATCH_ID, ROUND_NUM, deadline);

        BettingPool.BettingRound memory round = pool.getRound(MATCH_ID, ROUND_NUM);
        assertEq(round.matchId, MATCH_ID);
        assertEq(round.roundNumber, ROUND_NUM);
        assertEq(round.bettingDeadline, deadline);
        assertEq(round.poolCooperate, 0);
        assertEq(round.poolDefect, 0);
        assertEq(round.poolMixed, 0);
        assertEq(uint8(round.result), uint8(BettingPool.Outcome.NONE));
        assertFalse(round.settled);
        assertFalse(round.cancelled);
    }

    function test_openBettingRound_revert_duplicateRound() public {
        _openDefaultRound();

        vm.expectRevert(BettingPool.RoundAlreadyExists.selector);
        vm.prank(oracle);
        pool.openBettingRound(MATCH_ID, ROUND_NUM, block.timestamp + 2 hours);
    }

    function test_openBettingRound_revert_deadlineInPast() public {
        vm.warp(1000);

        vm.expectRevert(BettingPool.DeadlineInPast.selector);
        vm.prank(oracle);
        pool.openBettingRound(MATCH_ID, ROUND_NUM, block.timestamp - 1);
    }

    function test_openBettingRound_revert_deadlineAtCurrentTimestamp() public {
        vm.expectRevert(BettingPool.DeadlineInPast.selector);
        vm.prank(oracle);
        pool.openBettingRound(MATCH_ID, ROUND_NUM, block.timestamp);
    }

    function test_openBettingRound_multipleRoundsInSameMatch() public {
        _openRound(MATCH_ID, 1, block.timestamp + 1 hours);
        _openRound(MATCH_ID, 2, block.timestamp + 2 hours);
        _openRound(MATCH_ID, 3, block.timestamp + 3 hours);

        BettingPool.BettingRound memory r1 = pool.getRound(MATCH_ID, 1);
        BettingPool.BettingRound memory r2 = pool.getRound(MATCH_ID, 2);
        BettingPool.BettingRound memory r3 = pool.getRound(MATCH_ID, 3);

        assertEq(r1.roundNumber, 1);
        assertEq(r2.roundNumber, 2);
        assertEq(r3.roundNumber, 3);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 2. PLACING BETS
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_placeBet_validBet() public {
        _openDefaultRound();

        vm.expectEmit(true, true, true, true);
        emit BettingPool.BetPlaced(MATCH_ID, ROUND_NUM, alice, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        assertEq(pool.getUserBet(MATCH_ID, ROUND_NUM, alice, BettingPool.Outcome.BOTH_COOPERATE), HUNDRED_USDC);
        assertEq(pool.getTotalPool(MATCH_ID, ROUND_NUM), HUNDRED_USDC);

        BettingPool.BettingRound memory round = pool.getRound(MATCH_ID, ROUND_NUM);
        assertEq(round.poolCooperate, HUNDRED_USDC);
    }

    function test_placeBet_allOutcomes() public {
        _openDefaultRound();

        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);
        _placeBet(charlie, MATCH_ID, ROUND_NUM, BettingPool.Outcome.MIXED, HUNDRED_USDC);

        BettingPool.BettingRound memory round = pool.getRound(MATCH_ID, ROUND_NUM);
        assertEq(round.poolCooperate, HUNDRED_USDC);
        assertEq(round.poolDefect, HUNDRED_USDC);
        assertEq(round.poolMixed, HUNDRED_USDC);
        assertEq(pool.getTotalPool(MATCH_ID, ROUND_NUM), 3 * HUNDRED_USDC);
    }

    function test_placeBet_revert_belowMinimum() public {
        _openDefaultRound();

        vm.expectRevert(BettingPool.BetTooSmall.selector);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, ONE_USDC - 1);
    }

    function test_placeBet_revert_aboveMaximum() public {
        _openDefaultRound();

        vm.expectRevert(BettingPool.BetTooLarge.selector);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, 10_001e6);
    }

    function test_placeBet_exactMinimum() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, ONE_USDC);
        assertEq(pool.getUserBet(MATCH_ID, ROUND_NUM, alice, BettingPool.Outcome.BOTH_COOPERATE), ONE_USDC);
    }

    function test_placeBet_exactMaximum() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, 10_000e6);
        assertEq(pool.getUserBet(MATCH_ID, ROUND_NUM, alice, BettingPool.Outcome.BOTH_COOPERATE), 10_000e6);
    }

    function test_placeBet_revert_afterDeadline() public {
        _openDefaultRound();

        // Warp past deadline
        vm.warp(block.timestamp + 1 hours);

        vm.expectRevert(BettingPool.BettingClosed.selector);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
    }

    function test_placeBet_revert_afterSettled() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        // Warp past deadline, then settle
        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        vm.expectRevert(BettingPool.BettingClosed.selector);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);
    }

    function test_placeBet_revert_afterCancelled() public {
        _openDefaultRound();

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        vm.expectRevert(BettingPool.RoundAlreadyCancelled.selector);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
    }

    function test_placeBet_revert_invalidOutcome() public {
        _openDefaultRound();

        vm.expectRevert(BettingPool.InvalidOutcome.selector);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.NONE, HUNDRED_USDC);
    }

    function test_placeBet_revert_roundNotFound() public {
        vm.expectRevert(BettingPool.RoundNotFound.selector);
        _placeBet(alice, 999, 999, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
    }

    function test_placeBet_transfersUSDC() public {
        _openDefaultRound();

        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(alice);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        uint256 balanceAfter = IERC20(USDC_ADDRESS).balanceOf(alice);

        assertEq(balanceBefore - balanceAfter, HUNDRED_USDC);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(address(pool)), HUNDRED_USDC);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 3. SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_settleBettingRound_validOutcome() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);

        vm.expectEmit(true, true, false, true);
        emit BettingPool.BettingRoundSettled(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, 2 * HUNDRED_USDC);

        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        BettingPool.BettingRound memory round = pool.getRound(MATCH_ID, ROUND_NUM);
        assertTrue(round.settled);
        assertEq(uint8(round.result), uint8(BettingPool.Outcome.BOTH_COOPERATE));
    }

    function test_settleBettingRound_noWinnerCase() public {
        _openDefaultRound();
        // Only bet on COOPERATE and DEFECT, but outcome is MIXED
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.MIXED);

        // 1% ops fee should be accumulated
        uint256 totalPool = 2 * HUNDRED_USDC;
        uint256 expectedFee = (totalPool * 100) / 10_000; // 1%
        assertEq(pool.accumulatedFees(), expectedFee);
    }

    function test_settleBettingRound_normalFeeAccumulation() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        // 5% fee on total pool
        uint256 totalPool = 2 * HUNDRED_USDC;
        uint256 expectedFee = (totalPool * 500) / 10_000;
        assertEq(pool.accumulatedFees(), expectedFee);
    }

    function test_settleBettingRound_revert_doubleSettle() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        vm.expectRevert(BettingPool.RoundAlreadySettled.selector);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT);
    }

    function test_settleBettingRound_revert_invalidOutcome() public {
        _openDefaultRound();

        vm.expectRevert(BettingPool.InvalidOutcome.selector);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.NONE);
    }

    function test_settleBettingRound_revert_roundNotFound() public {
        vm.expectRevert(BettingPool.RoundNotFound.selector);
        _settleRound(999, 999, BettingPool.Outcome.BOTH_COOPERATE);
    }

    function test_settleBettingRound_revert_cancelled() public {
        _openDefaultRound();

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        vm.expectRevert(BettingPool.RoundAlreadyCancelled.selector);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);
    }

    function test_settleBettingRound_emptyPool() public {
        _openDefaultRound();
        vm.warp(block.timestamp + 2 hours);

        // Settling with no bets should not accumulate any fees
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        assertEq(pool.accumulatedFees(), 0);
        BettingPool.BettingRound memory round = pool.getRound(MATCH_ID, ROUND_NUM);
        assertTrue(round.settled);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 4. CLAIM WINNINGS
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_claimWinnings_proportionalPayout() public {
        _openDefaultRound();

        // Alice bets 100 USDC on COOPERATE, Bob bets 200 USDC on COOPERATE
        // Charlie bets 300 USDC on DEFECT (loser)
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, 200e6);
        _placeBet(charlie, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 300e6);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        uint256 totalPool = 600e6;
        uint256 protocolFee = (totalPool * 500) / 10_000; // 30 USDC
        uint256 distributable = totalPool - protocolFee; // 570 USDC
        uint256 winningPool = 300e6; // Alice + Bob

        // Alice: (100 / 300) * 570 = 190 USDC
        uint256 aliceExpected = (HUNDRED_USDC * distributable) / winningPool;
        // Bob: (200 / 300) * 570 = 380 USDC
        uint256 bobExpected = (200e6 * distributable) / winningPool;

        uint256 aliceBalBefore = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        uint256 aliceBalAfter = IERC20(USDC_ADDRESS).balanceOf(alice);
        assertEq(aliceBalAfter - aliceBalBefore, aliceExpected);

        uint256 bobBalBefore = IERC20(USDC_ADDRESS).balanceOf(bob);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        uint256 bobBalAfter = IERC20(USDC_ADDRESS).balanceOf(bob);
        assertEq(bobBalAfter - bobBalBefore, bobExpected);
    }

    function test_claimWinnings_noWinnerRefund() public {
        _openDefaultRound();

        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 200e6);

        vm.warp(block.timestamp + 2 hours);
        // Outcome is MIXED but nobody bet on MIXED
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.MIXED);

        uint256 totalPool = 300e6;
        uint256 opsFee = (totalPool * 100) / 10_000; // 1% = 3 USDC
        uint256 distributable = totalPool - opsFee; // 297 USDC

        // Alice gets (100 / 300) * 297 = 99 USDC
        uint256 aliceExpected = (HUNDRED_USDC * distributable) / totalPool;

        uint256 aliceBalBefore = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        uint256 aliceBalAfter = IERC20(USDC_ADDRESS).balanceOf(alice);
        assertEq(aliceBalAfter - aliceBalBefore, aliceExpected);

        // Bob gets (200 / 300) * 297 = 198 USDC
        uint256 bobExpected = (200e6 * distributable) / totalPool;

        uint256 bobBalBefore = IERC20(USDC_ADDRESS).balanceOf(bob);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        uint256 bobBalAfter = IERC20(USDC_ADDRESS).balanceOf(bob);
        assertEq(bobBalAfter - bobBalBefore, bobExpected);
    }

    function test_claimWinnings_revert_nothingToClaim() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        // Bob didn't bet, so nothing to claim
        vm.expectRevert(BettingPool.NothingToClaim.selector);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
    }

    function test_claimWinnings_revert_loserCantClaim() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        // Bob bet on DEFECT but outcome is COOPERATE
        vm.expectRevert(BettingPool.NothingToClaim.selector);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
    }

    function test_claimWinnings_revert_doubleClaim() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);

        vm.expectRevert(BettingPool.AlreadyClaimed.selector);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
    }

    function test_claimWinnings_revert_roundNotSettled() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.expectRevert(BettingPool.RoundNotSettled.selector);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
    }

    function test_claimWinnings_emitsEvent() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        // Solo winner gets total pool minus 5% fee
        uint256 protocolFee = (HUNDRED_USDC * 500) / 10_000;
        uint256 expectedPayout = HUNDRED_USDC - protocolFee;

        vm.expectEmit(true, true, true, true);
        emit BettingPool.WinningsClaimed(MATCH_ID, ROUND_NUM, alice, expectedPayout);

        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 5. REFUND ON CANCELLATION
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_refundBet_fullRefund() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 50e6);

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        uint256 balBefore = IERC20(USDC_ADDRESS).balanceOf(alice);

        vm.expectEmit(true, true, true, true);
        emit BettingPool.BetRefunded(MATCH_ID, ROUND_NUM, alice, 150e6);

        vm.prank(alice);
        pool.refundBet(MATCH_ID, ROUND_NUM);

        uint256 balAfter = IERC20(USDC_ADDRESS).balanceOf(alice);
        assertEq(balAfter - balBefore, 150e6);
    }

    function test_refundBet_revert_notCancelled() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.expectRevert(BettingPool.RoundNotCancelled.selector);
        vm.prank(alice);
        pool.refundBet(MATCH_ID, ROUND_NUM);
    }

    function test_refundBet_revert_doubleRefund() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        vm.prank(alice);
        pool.refundBet(MATCH_ID, ROUND_NUM);

        vm.expectRevert(BettingPool.AlreadyClaimed.selector);
        vm.prank(alice);
        pool.refundBet(MATCH_ID, ROUND_NUM);
    }

    function test_refundBet_revert_nothingToClaim() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        // Bob never bet
        vm.expectRevert(BettingPool.NothingToClaim.selector);
        vm.prank(bob);
        pool.refundBet(MATCH_ID, ROUND_NUM);
    }

    function test_refundBet_multipleBettors() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 200e6);

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.refundBet(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, HUNDRED_USDC);

        uint256 bobBal = IERC20(USDC_ADDRESS).balanceOf(bob);
        vm.prank(bob);
        pool.refundBet(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(bob) - bobBal, 200e6);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 6. FEE COLLECTION
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_collectFees_accumulatedCorrectly() public {
        // Round 1: normal settlement
        _openRound(1, 1, block.timestamp + 1 hours);
        _placeBet(alice, 1, 1, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, 1, 1, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(1, 1, BettingPool.Outcome.BOTH_COOPERATE);

        uint256 fee1 = (200e6 * 500) / 10_000; // 10 USDC

        // Round 2: no-winner settlement
        _openRound(2, 1, block.timestamp + 1 hours);
        _placeBet(alice, 2, 1, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(2, 1, BettingPool.Outcome.MIXED); // No one bet on MIXED

        uint256 fee2 = (HUNDRED_USDC * 100) / 10_000; // 1 USDC

        assertEq(pool.accumulatedFees(), fee1 + fee2);
    }

    function test_collectFees_ownerCanCollect() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        uint256 expectedFee = (200e6 * 500) / 10_000; // 10 USDC

        uint256 ownerBalBefore = IERC20(USDC_ADDRESS).balanceOf(owner);

        vm.expectEmit(false, false, false, true);
        emit BettingPool.ProtocolFeeCollected(expectedFee);

        vm.prank(owner);
        pool.collectFees();

        uint256 ownerBalAfter = IERC20(USDC_ADDRESS).balanceOf(owner);
        assertEq(ownerBalAfter - ownerBalBefore, expectedFee);
        assertEq(pool.accumulatedFees(), 0);
    }

    function test_collectFees_revert_noFees() public {
        vm.expectRevert(BettingPool.NoFeesToCollect.selector);
        vm.prank(owner);
        pool.collectFees();
    }

    function test_collectFees_revert_notOwner() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        vm.prank(attacker);
        pool.collectFees();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 7. ORACLE ACCESS CONTROL
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_oracle_nonOracleCantOpen() public {
        vm.expectRevert(BettingPool.NotOracle.selector);
        vm.prank(attacker);
        pool.openBettingRound(MATCH_ID, ROUND_NUM, block.timestamp + 1 hours);
    }

    function test_oracle_nonOracleCantSettle() public {
        _openDefaultRound();

        vm.expectRevert(BettingPool.NotOracle.selector);
        vm.prank(attacker);
        pool.settleBettingRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);
    }

    function test_oracle_nonOracleCantCancel() public {
        _openDefaultRound();

        vm.expectRevert(BettingPool.NotOracle.selector);
        vm.prank(attacker);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);
    }

    function test_oracle_ownerCantActAsOracle() public {
        vm.expectRevert(BettingPool.NotOracle.selector);
        vm.prank(owner);
        pool.openBettingRound(MATCH_ID, ROUND_NUM, block.timestamp + 1 hours);
    }

    function test_oracle_ownerCanUpdateOracle() public {
        address newOracle = makeAddr("newOracle");

        vm.expectEmit(true, true, false, false);
        emit BettingPool.OracleUpdated(oracle, newOracle);

        vm.prank(owner);
        pool.setOracle(newOracle);

        assertEq(pool.oracle(), newOracle);

        // New oracle can now open rounds
        vm.prank(newOracle);
        pool.openBettingRound(MATCH_ID, ROUND_NUM, block.timestamp + 1 hours);

        // Old oracle cannot
        vm.expectRevert(BettingPool.NotOracle.selector);
        vm.prank(oracle);
        pool.openBettingRound(MATCH_ID, 2, block.timestamp + 1 hours);
    }

    function test_oracle_setOracle_revert_zeroAddress() public {
        vm.expectRevert(BettingPool.ZeroAddress.selector);
        vm.prank(owner);
        pool.setOracle(address(0));
    }

    function test_oracle_setOracle_revert_notOwner() public {
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", attacker));
        vm.prank(attacker);
        pool.setOracle(makeAddr("newOracle"));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 8. MULTIPLE BETTORS - PROPORTIONAL DISTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_multipleBettors_proportionalDistribution() public {
        _openDefaultRound();

        // Winners: Alice 100, Bob 400 (total winning pool = 500)
        // Losers: Charlie 500
        // Total pool = 1000
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, 400e6);
        _placeBet(charlie, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 500e6);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        uint256 totalPool = 1000e6;
        uint256 protocolFee = (totalPool * 500) / 10_000; // 50 USDC
        uint256 distributable = totalPool - protocolFee; // 950 USDC
        uint256 winningPool = 500e6;

        // Alice: (100/500) * 950 = 190 USDC
        uint256 aliceExpected = (HUNDRED_USDC * distributable) / winningPool;
        assertEq(aliceExpected, 190e6);

        // Bob: (400/500) * 950 = 760 USDC
        uint256 bobExpected = (400e6 * distributable) / winningPool;
        assertEq(bobExpected, 760e6);

        // Verify payouts
        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, aliceExpected);

        uint256 bobBal = IERC20(USDC_ADDRESS).balanceOf(bob);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(bob) - bobBal, bobExpected);

        // Loser gets nothing
        vm.expectRevert(BettingPool.NothingToClaim.selector);
        vm.prank(charlie);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
    }

    function test_multipleBettors_sameAmount() public {
        _openDefaultRound();

        // 3 winners with equal bets, 1 loser
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(charlie, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        // Add a loser so there's extra to distribute
        address dan = makeAddr("dan");
        _mintUsdc(dan, 100_000e6);
        vm.prank(dan);
        IERC20(USDC_ADDRESS).approve(address(pool), type(uint256).max);
        _placeBet(dan, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 300e6);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        uint256 totalPool = 600e6;
        uint256 protocolFee = (totalPool * 500) / 10_000; // 30 USDC
        uint256 distributable = totalPool - protocolFee; // 570 USDC
        uint256 perWinner = (HUNDRED_USDC * distributable) / 300e6; // 190 USDC each

        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, perWinner);

        uint256 bobBal = IERC20(USDC_ADDRESS).balanceOf(bob);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(bob) - bobBal, perWinner);

        uint256 charlieBal = IERC20(USDC_ADDRESS).balanceOf(charlie);
        vm.prank(charlie);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(charlie) - charlieBal, perWinner);
    }

    function test_multipleBettors_soloWinner() public {
        _openDefaultRound();

        // Only Alice wins, Bob and Charlie lose
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 200e6);
        _placeBet(charlie, MATCH_ID, ROUND_NUM, BettingPool.Outcome.MIXED, 300e6);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        uint256 totalPool = 600e6;
        uint256 protocolFee = (totalPool * 500) / 10_000; // 30 USDC
        uint256 distributable = totalPool - protocolFee; // 570 USDC

        // Alice gets the entire distributable amount
        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, distributable);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 9. USER BETS ON MULTIPLE OUTCOMES IN SAME ROUND
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_multiOutcomeBet_onlyWinningOutcomePaysOut() public {
        _openDefaultRound();

        // Alice hedges: bets on COOPERATE and DEFECT
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 50e6);

        // Bob bets on COOPERATE only
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        // Total pool = 250, winning pool (COOPERATE) = 200
        uint256 totalPool = 250e6;
        uint256 protocolFee = (totalPool * 500) / 10_000; // 12.5 USDC
        uint256 distributable = totalPool - protocolFee; // 237.5 USDC
        uint256 winningPool = 200e6;

        // Alice wins: (100/200) * 237.5 = 118.75 USDC
        uint256 aliceExpected = (HUNDRED_USDC * distributable) / winningPool;
        // Bob wins: (100/200) * 237.5 = 118.75 USDC
        uint256 bobExpected = (HUNDRED_USDC * distributable) / winningPool;

        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, aliceExpected);

        uint256 bobBal = IERC20(USDC_ADDRESS).balanceOf(bob);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(bob) - bobBal, bobExpected);
    }

    function test_multiOutcomeBet_allThreeOutcomes() public {
        _openDefaultRound();

        // Alice bets on all three outcomes
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.MIXED, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT);

        // Total pool = 300, winning pool (DEFECT) = 100
        uint256 totalPool = 300e6;
        uint256 protocolFee = (totalPool * 500) / 10_000; // 15 USDC
        uint256 distributable = totalPool - protocolFee; // 285 USDC

        // Alice is sole winner, gets 285 USDC (net profit of 285 - 300 = -15, the fee)
        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, distributable);
    }

    function test_multiOutcomeBet_noWinnerRefundsAllBets() public {
        _openDefaultRound();

        // Alice bets on COOPERATE and DEFECT, but outcome is MIXED (no winners)
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 50e6);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.MIXED);

        // No one bet on MIXED, so it's a no-winner refund
        uint256 totalPool = 150e6;
        uint256 opsFee = (totalPool * 100) / 10_000; // 1.5 USDC
        uint256 distributable = totalPool - opsFee;

        // Alice's total bets = 150, she gets (150/150) * distributable = distributable
        uint256 aliceExpected = (150e6 * distributable) / totalPool;

        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, aliceExpected);
    }

    function test_multiOutcomeBet_stackingOnSameOutcome() public {
        _openDefaultRound();

        // Alice places multiple bets on the same outcome (additive)
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, 50e6);

        assertEq(pool.getUserBet(MATCH_ID, ROUND_NUM, alice, BettingPool.Outcome.BOTH_COOPERATE), 150e6);

        BettingPool.BettingRound memory round = pool.getRound(MATCH_ID, ROUND_NUM);
        assertEq(round.poolCooperate, 150e6);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ADDITIONAL EDGE CASES AND INTEGRATION TESTS
    // ═══════════════════════════════════════════════════════════════════════════════

    function test_constructor_revert_zeroOracle() public {
        vm.expectRevert(BettingPool.ZeroAddress.selector);
        new BettingPool(owner, address(0));
    }

    function test_roundKey_uniqueness() public view {
        // Different match/round combos should produce different keys
        bytes32 key1 = pool.getRoundKey(1, 1);
        bytes32 key2 = pool.getRoundKey(1, 2);
        bytes32 key3 = pool.getRoundKey(2, 1);

        assertTrue(key1 != key2);
        assertTrue(key1 != key3);
        assertTrue(key2 != key3);
    }

    function test_fullLifecycle_normalRound() public {
        // Open
        _openRound(MATCH_ID, ROUND_NUM, block.timestamp + 1 hours);

        // Bet
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, HUNDRED_USDC);

        // Time passes
        vm.warp(block.timestamp + 2 hours);

        // Settle
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        // Winner claims
        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        uint256 aliceGain = IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal;

        // Owner collects fees
        uint256 ownerBal = IERC20(USDC_ADDRESS).balanceOf(owner);
        vm.prank(owner);
        pool.collectFees();
        uint256 ownerGain = IERC20(USDC_ADDRESS).balanceOf(owner) - ownerBal;

        // Total distributed = winnings + fees = totalPool
        assertEq(aliceGain + ownerGain, 200e6);
    }

    function test_fullLifecycle_cancelledRound() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 200e6);

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        // Everyone gets full refund
        uint256 aliceBal = IERC20(USDC_ADDRESS).balanceOf(alice);
        vm.prank(alice);
        pool.refundBet(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(alice) - aliceBal, HUNDRED_USDC);

        uint256 bobBal = IERC20(USDC_ADDRESS).balanceOf(bob);
        vm.prank(bob);
        pool.refundBet(MATCH_ID, ROUND_NUM);
        assertEq(IERC20(USDC_ADDRESS).balanceOf(bob) - bobBal, 200e6);

        // No fees accumulated on cancellation
        assertEq(pool.accumulatedFees(), 0);
    }

    function test_cancelRound_revert_alreadyCancelled() public {
        _openDefaultRound();

        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);

        vm.expectRevert(BettingPool.RoundAlreadyCancelled.selector);
        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);
    }

    function test_cancelRound_revert_alreadySettled() public {
        _openDefaultRound();
        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        vm.expectRevert(BettingPool.RoundAlreadySettled.selector);
        vm.prank(oracle);
        pool.cancelBettingRound(MATCH_ID, ROUND_NUM);
    }

    function test_cancelRound_revert_roundNotFound() public {
        vm.expectRevert(BettingPool.RoundNotFound.selector);
        vm.prank(oracle);
        pool.cancelBettingRound(999, 999);
    }

    function test_viewFunctions_getTotalPool() public {
        _openDefaultRound();
        assertEq(pool.getTotalPool(MATCH_ID, ROUND_NUM), 0);

        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, HUNDRED_USDC);
        assertEq(pool.getTotalPool(MATCH_ID, ROUND_NUM), HUNDRED_USDC);

        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, 200e6);
        assertEq(pool.getTotalPool(MATCH_ID, ROUND_NUM), 300e6);
    }

    function test_ownership_twoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        pool.transferOwnership(newOwner);

        // Still old owner until accepted
        assertEq(pool.owner(), owner);

        vm.prank(newOwner);
        pool.acceptOwnership();

        assertEq(pool.owner(), newOwner);
    }

    function test_solvencyInvariant_feesAndPayoutsEqualDeposits() public {
        // Complex scenario: ensure no USDC is created or destroyed
        _openDefaultRound();

        uint256 aliceBet = 100e6;
        uint256 bobBet = 200e6;
        uint256 charlieBet = 300e6;

        _placeBet(alice, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, aliceBet);
        _placeBet(bob, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE, bobBet);
        _placeBet(charlie, MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_DEFECT, charlieBet);

        uint256 totalDeposited = aliceBet + bobBet + charlieBet;
        assertEq(totalDeposited, 600e6); // Sanity check

        vm.warp(block.timestamp + 2 hours);
        _settleRound(MATCH_ID, ROUND_NUM, BettingPool.Outcome.BOTH_COOPERATE);

        // Claims
        vm.prank(alice);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);
        vm.prank(bob);
        pool.claimWinnings(MATCH_ID, ROUND_NUM);

        // Collect fees
        vm.prank(owner);
        pool.collectFees();

        // Pool should have exactly 0 USDC remaining (all distributed)
        uint256 poolBalance = IERC20(USDC_ADDRESS).balanceOf(address(pool));
        assertEq(poolBalance, 0);

        // Verify total outflow equals total inflow
        // (alice payout + bob payout + owner fees should equal totalDeposited)
        // This is implicitly verified by poolBalance == 0
    }
}

