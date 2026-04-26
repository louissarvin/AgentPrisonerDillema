// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {GameManager} from "../src/GameManager.sol";

contract GameManagerTest is Test {
    GameManager public game;

    address public owner = makeAddr("owner");
    address public agentA = makeAddr("agentA");
    address public agentB = makeAddr("agentB");
    address public outsider = makeAddr("outsider");

    uint256 public constant STAKE = 1 ether;
    bytes32 public constant SECRET_A = keccak256("secretA");
    bytes32 public constant SECRET_B = keccak256("secretB");

    // Cache contract constants to avoid external calls that consume vm.prank
    uint8 constant COOPERATE = 0;
    uint8 constant DEFECT = 1;
    uint8 constant UNSET = 255;
    uint256 constant COMMIT_DURATION = 60;
    uint256 constant REVEAL_DURATION = 30;
    uint256 constant MAX_ROUNDS = 50;

    function setUp() public {
        game = new GameManager(owner);
    }

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    function _createMatch() internal returns (uint256 matchId) {
        vm.prank(owner);
        matchId = game.createMatch(agentA, agentB, STAKE);
    }

    function _commitBothCooperate(uint256 matchId) internal {
        bytes32 commitA = game.computeCommitment(COOPERATE, SECRET_A);
        bytes32 commitB = game.computeCommitment(COOPERATE, SECRET_B);

        vm.prank(agentA);
        game.commitMove(matchId, commitA);
        vm.prank(agentB);
        game.commitMove(matchId, commitB);
    }

    function _commitBothDefect(uint256 matchId) internal {
        bytes32 commitA = game.computeCommitment(DEFECT, SECRET_A);
        bytes32 commitB = game.computeCommitment(DEFECT, SECRET_B);

        vm.prank(agentA);
        game.commitMove(matchId, commitA);
        vm.prank(agentB);
        game.commitMove(matchId, commitB);
    }

    function _commitMixed(uint256 matchId, uint8 moveA, uint8 moveB) internal {
        bytes32 commitA = game.computeCommitment(moveA, SECRET_A);
        bytes32 commitB = game.computeCommitment(moveB, SECRET_B);

        vm.prank(agentA);
        game.commitMove(matchId, commitA);
        vm.prank(agentB);
        game.commitMove(matchId, commitB);
    }

    function _revealBoth(uint256 matchId, uint8 moveA, uint8 moveB) internal {
        // Advance past commit deadline into reveal phase
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agentA);
        game.revealMove(matchId, moveA, SECRET_A);
        vm.prank(agentB);
        game.revealMove(matchId, moveB, SECRET_B);
    }

    function _playFullRound(uint256 matchId, uint8 moveA, uint8 moveB) internal {
        _commitMixed(matchId, moveA, moveB);
        _revealBoth(matchId, moveA, moveB);

        vm.prank(owner);
        game.resolveRound(matchId);
    }

    // ─────────────────────────────────────────────────────────────────
    // Match Creation Tests
    // ─────────────────────────────────────────────────────────────────

    function test_createMatch_success() public {
        vm.prank(owner);

        vm.expectEmit(true, true, true, true);
        emit GameManager.MatchCreated(0, agentA, agentB, STAKE);

        uint256 matchId = game.createMatch(agentA, agentB, STAKE);
        assertEq(matchId, 0);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.agentA, agentA);
        assertEq(m.agentB, agentB);
        assertEq(m.stakePerRound, STAKE);
        assertEq(m.currentRound, 0);
        assertEq(m.scoreA, 0);
        assertEq(m.scoreB, 0);
        assertTrue(m.active);
        assertEq(m.startedAt, block.timestamp);
    }

    function test_createMatch_incrementsMatchCount() public {
        vm.startPrank(owner);
        game.createMatch(agentA, agentB, STAKE);
        game.createMatch(agentA, agentB, STAKE);
        vm.stopPrank();

        assertEq(game.matchCount(), 2);
    }

    function test_createMatch_startsFirstRound() public {
        uint256 matchId = _createMatch();

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertEq(rd.commitDeadline, block.timestamp + COMMIT_DURATION);
        assertEq(rd.revealDeadline, block.timestamp + COMMIT_DURATION + REVEAL_DURATION);
        assertEq(rd.moveA, UNSET);
        assertEq(rd.moveB, UNSET);
        assertFalse(rd.resolved);
    }

    function test_createMatch_revertsOnZeroAddressA() public {
        vm.prank(owner);
        vm.expectRevert(GameManager.ZeroAddress.selector);
        game.createMatch(address(0), agentB, STAKE);
    }

    function test_createMatch_revertsOnZeroAddressB() public {
        vm.prank(owner);
        vm.expectRevert(GameManager.ZeroAddress.selector);
        game.createMatch(agentA, address(0), STAKE);
    }

    function test_createMatch_revertsOnSameAgent() public {
        vm.prank(owner);
        vm.expectRevert(GameManager.SameAgent.selector);
        game.createMatch(agentA, agentA, STAKE);
    }

    function test_createMatch_revertsOnZeroStake() public {
        vm.prank(owner);
        vm.expectRevert(GameManager.ZeroStake.selector);
        game.createMatch(agentA, agentB, 0);
    }

    function test_createMatch_revertsForNonOwner() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", outsider));
        game.createMatch(agentA, agentB, STAKE);
    }

    // ─────────────────────────────────────────────────────────────────
    // Commit Phase Tests
    // ─────────────────────────────────────────────────────────────────

    function test_commitMove_agentA() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.expectEmit(true, true, true, true);
        emit GameManager.MoveCommitted(matchId, 0, agentA);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertEq(rd.commitA, commitment);
    }

    function test_commitMove_agentB() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(DEFECT, SECRET_B);

        vm.prank(agentB);
        game.commitMove(matchId, commitment);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertEq(rd.commitB, commitment);
    }

    function test_commitMove_bothAgentsCommit() public {
        uint256 matchId = _createMatch();
        _commitBothCooperate(matchId);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertNotEq(rd.commitA, bytes32(0));
        assertNotEq(rd.commitB, bytes32(0));
    }

    function test_commitMove_revertsOnDuplicateCommitA() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        vm.prank(agentA);
        vm.expectRevert(GameManager.AlreadyCommitted.selector);
        game.commitMove(matchId, commitment);
    }

    function test_commitMove_revertsOnDuplicateCommitB() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_B);

        vm.prank(agentB);
        game.commitMove(matchId, commitment);

        vm.prank(agentB);
        vm.expectRevert(GameManager.AlreadyCommitted.selector);
        game.commitMove(matchId, commitment);
    }

    function test_commitMove_revertsAfterCommitDeadline() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        // Warp past commit deadline
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agentA);
        vm.expectRevert(GameManager.CommitPhaseExpired.selector);
        game.commitMove(matchId, commitment);
    }

    function test_commitMove_revertsForNonParticipant() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(outsider);
        vm.expectRevert(GameManager.NotParticipant.selector);
        game.commitMove(matchId, commitment);
    }

    function test_commitMove_revertsForInactiveMatch() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        // Force end the match
        vm.prank(owner);
        game.forceEndMatch(matchId, "test");

        vm.prank(agentA);
        vm.expectRevert(GameManager.MatchNotActive.selector);
        game.commitMove(matchId, commitment);
    }

    function test_commitMove_atExactDeadline() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        // Warp to exactly the commit deadline (should still work, > not >=)
        vm.warp(block.timestamp + COMMIT_DURATION);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertEq(rd.commitA, commitment);
    }

    // ─────────────────────────────────────────────────────────────────
    // Reveal Phase Tests
    // ─────────────────────────────────────────────────────────────────

    function test_revealMove_agentA_cooperate() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        // Move to reveal phase
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.expectEmit(true, true, true, true);
        emit GameManager.MoveRevealed(matchId, 0, agentA, COOPERATE);

        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertTrue(rd.revealedA);
        assertEq(rd.moveA, COOPERATE);
    }

    function test_revealMove_agentB_defect() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(DEFECT, SECRET_B);

        vm.prank(agentB);
        game.commitMove(matchId, commitment);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agentB);
        game.revealMove(matchId, DEFECT, SECRET_B);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertTrue(rd.revealedB);
        assertEq(rd.moveB, DEFECT);
    }

    function test_revealMove_revertsWithInvalidHash() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        // Reveal with wrong secret
        vm.prank(agentA);
        vm.expectRevert(GameManager.InvalidCommitment.selector);
        game.revealMove(matchId, COOPERATE, keccak256("wrongSecret"));
    }

    function test_revealMove_revertsWithWrongMove() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        // Committed COOPERATE but trying to reveal DEFECT
        vm.prank(agentA);
        vm.expectRevert(GameManager.InvalidCommitment.selector);
        game.revealMove(matchId, DEFECT, SECRET_A);
    }

    function test_revealMove_revertsBeforeCommitDeadline() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        // Do NOT advance past commit deadline
        vm.prank(agentA);
        vm.expectRevert(GameManager.NotInRevealPhase.selector);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    function test_revealMove_revertsAtExactCommitDeadline() public {
        uint256 matchId = _createMatch();

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        // Warp to exactly commit deadline (condition is <=, so it should revert)
        vm.warp(rd.commitDeadline);

        vm.prank(agentA);
        vm.expectRevert(GameManager.NotInRevealPhase.selector);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    function test_revealMove_revertsAfterRevealDeadline() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        // Warp past reveal deadline
        vm.warp(block.timestamp + COMMIT_DURATION + REVEAL_DURATION + 1);

        vm.prank(agentA);
        vm.expectRevert(GameManager.RevealPhaseExpired.selector);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    function test_revealMove_revertsOnDuplicateReveal() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);

        vm.prank(agentA);
        vm.expectRevert(GameManager.AlreadyRevealed.selector);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    function test_revealMove_revertsForNonParticipant() public {
        uint256 matchId = _createMatch();

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(outsider);
        vm.expectRevert(GameManager.NotParticipant.selector);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    function test_revealMove_revertsForInvalidMove() public {
        uint256 matchId = _createMatch();
        // Create a commitment with an invalid move value using raw encoding
        uint8 invalidMove = 2;
        bytes32 commitment = keccak256(abi.encodePacked(invalidMove, SECRET_A));

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agentA);
        vm.expectRevert(GameManager.InvalidMove.selector);
        game.revealMove(matchId, invalidMove, SECRET_A);
    }

    function test_revealMove_revertsForInactiveMatch() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        vm.prank(owner);
        game.forceEndMatch(matchId, "test");

        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agentA);
        vm.expectRevert(GameManager.MatchNotActive.selector);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    // ─────────────────────────────────────────────────────────────────
    // Round Resolution Tests
    // ─────────────────────────────────────────────────────────────────

    function test_resolveRound_bothRevealed() public {
        uint256 matchId = _createMatch();
        _commitBothCooperate(matchId);
        _revealBoth(matchId, COOPERATE, COOPERATE);

        vm.expectEmit(true, true, false, true);
        emit GameManager.RoundResolved(matchId, 0, COOPERATE, COOPERATE, 3 * STAKE, 3 * STAKE);

        vm.prank(owner);
        game.resolveRound(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 3 * STAKE);
        assertEq(m.scoreB, 3 * STAKE);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertTrue(rd.resolved);
    }

    function test_resolveRound_timeoutPenalty_neitherCommitted() public {
        uint256 matchId = _createMatch();

        // Nobody commits; warp past reveal deadline
        vm.warp(block.timestamp + COMMIT_DURATION + REVEAL_DURATION + 1);

        vm.prank(owner);
        game.resolveRound(matchId);

        // Both forced to defect (PAYOFF_P = 1)
        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 1 * STAKE);
        assertEq(m.scoreB, 1 * STAKE);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertEq(rd.moveA, DEFECT);
        assertEq(rd.moveB, DEFECT);
    }

    function test_resolveRound_timeoutPenalty_onlyACommitted() public {
        uint256 matchId = _createMatch();

        // Only A commits but does not reveal
        bytes32 commitA = game.computeCommitment(COOPERATE, SECRET_A);
        vm.prank(agentA);
        game.commitMove(matchId, commitA);

        // Warp past reveal deadline
        vm.warp(block.timestamp + COMMIT_DURATION + REVEAL_DURATION + 1);

        vm.prank(owner);
        game.resolveRound(matchId);

        // A committed but did not reveal = forced defect
        // B did not commit = forced defect
        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 1 * STAKE); // Both defect: P=1
        assertEq(m.scoreB, 1 * STAKE);
    }

    function test_resolveRound_timeoutPenalty_onlyAReveals() public {
        uint256 matchId = _createMatch();

        // Both commit
        _commitMixed(matchId, COOPERATE, COOPERATE);

        // Only A reveals
        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);

        // Warp past reveal deadline
        vm.warp(block.timestamp + REVEAL_DURATION + 1);

        vm.prank(owner);
        game.resolveRound(matchId);

        // A cooperated, B forced defect: A gets S=0, B gets T=5
        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 0 * STAKE); // PAYOFF_S
        assertEq(m.scoreB, 5 * STAKE); // PAYOFF_T
    }

    function test_resolveRound_revertsIfAlreadyResolved() public {
        uint256 matchId = _createMatch();
        _commitBothCooperate(matchId);
        _revealBoth(matchId, COOPERATE, COOPERATE);

        vm.prank(owner);
        game.resolveRound(matchId);

        vm.prank(owner);
        vm.expectRevert(GameManager.RoundAlreadyResolved.selector);
        game.resolveRound(matchId);
    }

    function test_resolveRound_revertsIfRevealPhaseNotExpired() public {
        uint256 matchId = _createMatch();

        // Only one agent reveals
        bytes32 commitA = game.computeCommitment(COOPERATE, SECRET_A);
        vm.prank(agentA);
        game.commitMove(matchId, commitA);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);

        // Reveal phase not expired yet, and only one revealed
        vm.prank(owner);
        vm.expectRevert(GameManager.RevealPhaseNotExpired.selector);
        game.resolveRound(matchId);
    }

    function test_resolveRound_revertsForNonOwner() public {
        uint256 matchId = _createMatch();
        _commitBothCooperate(matchId);
        _revealBoth(matchId, COOPERATE, COOPERATE);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", outsider));
        game.resolveRound(matchId);
    }

    function test_resolveRound_revertsForInactiveMatch() public {
        uint256 matchId = _createMatch();

        vm.prank(owner);
        game.forceEndMatch(matchId, "over");

        vm.prank(owner);
        vm.expectRevert(GameManager.MatchNotActive.selector);
        game.resolveRound(matchId);
    }

    function test_resolveRound_immediatelyAfterBothReveal() public {
        uint256 matchId = _createMatch();
        _commitBothCooperate(matchId);

        // Advance to reveal phase
        vm.warp(block.timestamp + COMMIT_DURATION + 1);

        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);
        vm.prank(agentB);
        game.revealMove(matchId, COOPERATE, SECRET_B);

        // Both revealed, can resolve immediately without waiting for deadline
        vm.prank(owner);
        game.resolveRound(matchId);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);
        assertTrue(rd.resolved);
    }

    // ─────────────────────────────────────────────────────────────────
    // Game Ending Tests
    // ─────────────────────────────────────────────────────────────────

    function test_checkGameEnd_maxRoundsReached() public {
        uint256 matchId = _createMatch();

        // Play 49 rounds (index 0 to 48), triggering checkGameEnd that does not end
        for (uint256 i = 0; i < 49; i++) {
            _playFullRound(matchId, COOPERATE, COOPERATE);

            // Force prevrandao to not trigger random end
            vm.prevrandao(bytes32(uint256(100))); // 100 % 100 = 0... pick a value that won't trigger
            // Actually, need to pick a value where val % 100 >= 5
            vm.prevrandao(bytes32(uint256(99))); // 99 % 100 = 99, which is >= 5 (no end)

            vm.prank(owner);
            game.checkGameEnd(matchId);
        }

        // Now at round 49 (the last allowed round index). Play it.
        _playFullRound(matchId, COOPERATE, COOPERATE);

        // checkGameEnd: currentRound + 1 = 50 >= MAX_ROUNDS = 50 => end
        vm.expectEmit(true, false, false, true);
        emit GameManager.MatchEnded(matchId, 50 * 3 * STAKE, 50 * 3 * STAKE, "max_rounds_reached");

        vm.prank(owner);
        game.checkGameEnd(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        assertFalse(m.active);
    }

    function test_checkGameEnd_randomTermination() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        // Set prevrandao such that value % 100 < 5 (triggers random end)
        // prevrandao = 3 => 3 % 100 = 3 < 5 => random termination
        vm.prevrandao(bytes32(uint256(3)));

        vm.expectEmit(true, false, false, true);
        emit GameManager.MatchEnded(matchId, 3 * STAKE, 3 * STAKE, "random_termination");

        vm.prank(owner);
        game.checkGameEnd(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        assertFalse(m.active);
    }

    function test_checkGameEnd_noTermination_advancesRound() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        // Set prevrandao so no end: 50 % 100 = 50 >= 5
        vm.prevrandao(bytes32(uint256(50)));

        vm.prank(owner);
        game.checkGameEnd(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        assertTrue(m.active);
        assertEq(m.currentRound, 1);

        // New round should be started
        GameManager.RoundData memory rd = game.getRound(matchId, 1);
        assertGt(rd.commitDeadline, 0);
        assertGt(rd.revealDeadline, rd.commitDeadline);
    }

    function test_checkGameEnd_revertsIfRoundNotResolved() public {
        uint256 matchId = _createMatch();

        // Don't resolve the round
        vm.prank(owner);
        vm.expectRevert(GameManager.RoundNotResolved.selector);
        game.checkGameEnd(matchId);
    }

    function test_checkGameEnd_revertsForInactiveMatch() public {
        uint256 matchId = _createMatch();

        vm.prank(owner);
        game.forceEndMatch(matchId, "done");

        vm.prank(owner);
        vm.expectRevert(GameManager.MatchNotActive.selector);
        game.checkGameEnd(matchId);
    }

    function test_checkGameEnd_revertsForNonOwner() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", outsider));
        game.checkGameEnd(matchId);
    }

    function test_forceEndMatch_success() public {
        uint256 matchId = _createMatch();

        vm.expectEmit(true, false, false, true);
        emit GameManager.MatchEnded(matchId, 0, 0, "agent_disconnected");

        vm.prank(owner);
        game.forceEndMatch(matchId, "agent_disconnected");

        GameManager.Match memory m = game.getMatch(matchId);
        assertFalse(m.active);
    }

    function test_forceEndMatch_revertsIfAlreadyEnded() public {
        uint256 matchId = _createMatch();

        vm.prank(owner);
        game.forceEndMatch(matchId, "first");

        vm.prank(owner);
        vm.expectRevert(GameManager.MatchNotActive.selector);
        game.forceEndMatch(matchId, "second");
    }

    function test_forceEndMatch_revertsForNonOwner() public {
        uint256 matchId = _createMatch();

        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", outsider));
        game.forceEndMatch(matchId, "hack");
    }

    // ─────────────────────────────────────────────────────────────────
    // Payoff Matrix Tests
    // ─────────────────────────────────────────────────────────────────

    function test_payoff_bothCooperate() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 3 * STAKE); // PAYOFF_R = 3
        assertEq(m.scoreB, 3 * STAKE); // PAYOFF_R = 3
    }

    function test_payoff_aDefects_bCooperates() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, DEFECT, COOPERATE);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 5 * STAKE); // PAYOFF_T = 5
        assertEq(m.scoreB, 0 * STAKE); // PAYOFF_S = 0
    }

    function test_payoff_aCooperates_bDefects() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, DEFECT);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 0 * STAKE); // PAYOFF_S = 0
        assertEq(m.scoreB, 5 * STAKE); // PAYOFF_T = 5
    }

    function test_payoff_bothDefect() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, DEFECT, DEFECT);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 1 * STAKE); // PAYOFF_P = 1
        assertEq(m.scoreB, 1 * STAKE); // PAYOFF_P = 1
    }

    // ─────────────────────────────────────────────────────────────────
    // Score Accumulation Tests
    // ─────────────────────────────────────────────────────────────────

    function test_scoreAccumulation_multipleRounds() public {
        uint256 matchId = _createMatch();

        // Round 0: Both cooperate => A: 3, B: 3
        _playFullRound(matchId, COOPERATE, COOPERATE);
        vm.prevrandao(bytes32(uint256(50))); // no random end
        vm.prank(owner);
        game.checkGameEnd(matchId);

        // Round 1: A defects, B cooperates => A: 3+5=8, B: 3+0=3
        _playFullRound(matchId, DEFECT, COOPERATE);
        vm.prevrandao(bytes32(uint256(50)));
        vm.prank(owner);
        game.checkGameEnd(matchId);

        // Round 2: Both defect => A: 8+1=9, B: 3+1=4
        _playFullRound(matchId, DEFECT, DEFECT);
        vm.prevrandao(bytes32(uint256(50)));
        vm.prank(owner);
        game.checkGameEnd(matchId);

        // Round 3: A cooperates, B defects => A: 9+0=9, B: 4+5=9
        _playFullRound(matchId, COOPERATE, DEFECT);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 9 * STAKE);
        assertEq(m.scoreB, 9 * STAKE);
        assertEq(m.currentRound, 3);
    }

    function test_scoreAccumulation_withTimeoutPenalties() public {
        uint256 matchId = _createMatch();

        // Round 0: Both cooperate normally
        _playFullRound(matchId, COOPERATE, COOPERATE);
        vm.prevrandao(bytes32(uint256(50)));
        vm.prank(owner);
        game.checkGameEnd(matchId);

        // Round 1: Nobody commits (timeout) => Both forced defect
        vm.warp(block.timestamp + COMMIT_DURATION + REVEAL_DURATION + 1);
        vm.prank(owner);
        game.resolveRound(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        // Round 0: R=3 each, Round 1: P=1 each
        assertEq(m.scoreA, (3 + 1) * STAKE);
        assertEq(m.scoreB, (3 + 1) * STAKE);
    }

    // ─────────────────────────────────────────────────────────────────
    // Access Control Tests
    // ─────────────────────────────────────────────────────────────────

    function test_accessControl_onlyOwnerCanCreateMatch() public {
        vm.prank(agentA);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", agentA));
        game.createMatch(agentA, agentB, STAKE);
    }

    function test_accessControl_onlyOwnerCanResolveRound() public {
        uint256 matchId = _createMatch();
        _commitBothCooperate(matchId);
        _revealBoth(matchId, COOPERATE, COOPERATE);

        vm.prank(agentA);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", agentA));
        game.resolveRound(matchId);
    }

    function test_accessControl_onlyOwnerCanCheckGameEnd() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        vm.prank(agentB);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", agentB));
        game.checkGameEnd(matchId);
    }

    function test_accessControl_onlyOwnerCanForceEnd() public {
        uint256 matchId = _createMatch();

        vm.prank(agentA);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", agentA));
        game.forceEndMatch(matchId, "unauthorized");
    }

    function test_accessControl_anyoneCanCommitIfParticipant() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        // agentA can commit
        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        // owner cannot commit (not a participant)
        bytes32 commitment2 = game.computeCommitment(DEFECT, SECRET_B);
        vm.prank(owner);
        vm.expectRevert(GameManager.NotParticipant.selector);
        game.commitMove(matchId, commitment2);
    }

    // ─────────────────────────────────────────────────────────────────
    // Edge Cases
    // ─────────────────────────────────────────────────────────────────

    function test_edge_resolveBeforeRevealDeadlineRequiresBothRevealed() public {
        uint256 matchId = _createMatch();

        // Only A commits and reveals
        bytes32 commitA = game.computeCommitment(COOPERATE, SECRET_A);
        vm.prank(agentA);
        game.commitMove(matchId, commitA);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);

        // Try to resolve before reveal deadline with only one reveal
        vm.prank(owner);
        vm.expectRevert(GameManager.RevealPhaseNotExpired.selector);
        game.resolveRound(matchId);
    }

    function test_edge_commitAtLastSecond() public {
        uint256 matchId = _createMatch();
        GameManager.RoundData memory rd = game.getRound(matchId, 0);

        // Commit at exact deadline (block.timestamp == commitDeadline, check is >)
        vm.warp(rd.commitDeadline);

        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);
        vm.prank(agentA);
        game.commitMove(matchId, commitment);
    }

    function test_edge_revealAtLastSecond() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);

        // Reveal at exact reveal deadline (check is >)
        vm.warp(rd.revealDeadline);
        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    function test_edge_revealOneSecondAfterDeadline_reverts() public {
        uint256 matchId = _createMatch();
        bytes32 commitment = game.computeCommitment(COOPERATE, SECRET_A);

        vm.prank(agentA);
        game.commitMove(matchId, commitment);

        GameManager.RoundData memory rd = game.getRound(matchId, 0);

        // One second after reveal deadline
        vm.warp(rd.revealDeadline + 1);
        vm.prank(agentA);
        vm.expectRevert(GameManager.RevealPhaseExpired.selector);
        game.revealMove(matchId, COOPERATE, SECRET_A);
    }

    function test_edge_multipleMatchesIndependent() public {
        uint256 match1 = _createMatch();

        vm.prank(owner);
        uint256 match2 = game.createMatch(agentA, agentB, 2 ether);

        // Play round in match1
        _playFullRound(match1, COOPERATE, COOPERATE);

        // Match 2 should be unaffected
        GameManager.Match memory m2 = game.getMatch(match2);
        assertEq(m2.scoreA, 0);
        assertEq(m2.scoreB, 0);
        assertEq(m2.currentRound, 0);
    }

    function test_edge_computeCommitment_correctness() public view {
        bytes32 hash = game.computeCommitment(COOPERATE, SECRET_A);
        bytes32 expected = keccak256(abi.encodePacked(COOPERATE, SECRET_A));
        assertEq(hash, expected);

        bytes32 hash2 = game.computeCommitment(DEFECT, SECRET_B);
        bytes32 expected2 = keccak256(abi.encodePacked(DEFECT, SECRET_B));
        assertEq(hash2, expected2);

        // Different inputs produce different hashes
        assertNotEq(hash, hash2);
    }

    function test_edge_prevrandaoBoundaryValues() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        // prevrandao = 4 => 4 % 100 = 4 < 5 => random termination
        vm.prevrandao(bytes32(uint256(4)));
        vm.prank(owner);
        game.checkGameEnd(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        assertFalse(m.active);
    }

    function test_edge_prevrandaoExactBoundary_noTermination() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        // prevrandao = 5 => 5 % 100 = 5, which is NOT < 5 => no end
        vm.prevrandao(bytes32(uint256(5)));
        vm.prank(owner);
        game.checkGameEnd(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        assertTrue(m.active);
        assertEq(m.currentRound, 1);
    }

    function test_edge_roundStartedEvent() public {
        uint256 matchId = _createMatch();
        _playFullRound(matchId, COOPERATE, COOPERATE);

        vm.prevrandao(bytes32(uint256(50)));

        uint256 expectedCommitDeadline = block.timestamp + COMMIT_DURATION;
        uint256 expectedRevealDeadline = block.timestamp + COMMIT_DURATION + REVEAL_DURATION;

        vm.expectEmit(true, false, false, true);
        emit GameManager.RoundStarted(matchId, 1, expectedCommitDeadline, expectedRevealDeadline);

        vm.prank(owner);
        game.checkGameEnd(matchId);
    }

    function test_edge_viewFunctions_nonexistentMatch() public view {
        // Should return zero-initialized struct without reverting
        GameManager.Match memory m = game.getMatch(999);
        assertEq(m.agentA, address(0));
        assertEq(m.agentB, address(0));
        assertFalse(m.active);

        GameManager.RoundData memory rd = game.getRound(999, 0);
        assertEq(rd.commitA, bytes32(0));
        assertFalse(rd.resolved);
    }

    function test_edge_stakePerRound_multipliesCorrectly() public {
        // Use a non-trivial stake to verify multiplication
        uint256 customStake = 7 ether;
        vm.prank(owner);
        uint256 matchId = game.createMatch(agentA, agentB, customStake);

        // Both cooperate: R=3, so score = 3 * 7 ether = 21 ether
        _commitMixed(matchId, COOPERATE, COOPERATE);

        vm.warp(block.timestamp + COMMIT_DURATION + 1);
        vm.prank(agentA);
        game.revealMove(matchId, COOPERATE, SECRET_A);
        vm.prank(agentB);
        game.revealMove(matchId, COOPERATE, SECRET_B);

        vm.prank(owner);
        game.resolveRound(matchId);

        GameManager.Match memory m = game.getMatch(matchId);
        assertEq(m.scoreA, 3 * customStake);
        assertEq(m.scoreB, 3 * customStake);
    }
}

