// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract GameManager is Ownable {

    error ZeroAddress();
    error SameAgent();
    error ZeroStake();
    error MatchNotActive();
    error NotParticipant();
    error AlreadyCommitted();
    error CommitPhaseExpired();
    error NotInRevealPhase();
    error AlreadyRevealed();
    error RevealPhaseExpired();
    error InvalidCommitment();
    error InvalidMove();
    error RoundNotFullyRevealed();
    error RoundAlreadyResolved();
    error RevealPhaseNotExpired();
    error CommitPhaseNotExpired();
    error MatchAlreadyEnded();
    error RoundNotResolved();

    uint8 public constant COOPERATE = 0;
    uint8 public constant DEFECT = 1;
    uint8 public constant UNSET = 255;
    uint256 public constant PAYOFF_R = 3;
    uint256 public constant PAYOFF_T = 5;
    uint256 public constant PAYOFF_P = 1;
    uint256 public constant PAYOFF_S = 0;
    uint256 public constant COMMIT_DURATION = 90;
    uint256 public constant REVEAL_DURATION = 30;
    uint256 public constant MAX_ROUNDS = 50;
    uint256 public constant END_PROBABILITY_NUMERATOR = 5;
    uint256 public constant END_PROBABILITY_DENOMINATOR = 100;

    event MatchCreated(
        uint256 indexed matchId, address indexed agentA, address indexed agentB, uint256 stakePerRound
    );
    event RoundStarted(uint256 indexed matchId, uint256 round, uint256 commitDeadline, uint256 revealDeadline);
    event MoveCommitted(uint256 indexed matchId, uint256 round, address indexed agent);
    event MoveRevealed(uint256 indexed matchId, uint256 round, address indexed agent, uint8 move);
    event RoundResolved(
        uint256 indexed matchId, uint256 round, uint8 moveA, uint8 moveB, uint256 scoreA, uint256 scoreB
    );
    event MatchEnded(uint256 indexed matchId, uint256 totalScoreA, uint256 totalScoreB, string reason);

    struct Match {
        address agentA;
        address agentB;
        uint256 currentRound;
        uint256 scoreA;
        uint256 scoreB;
        uint256 stakePerRound;
        bool active;
        uint256 startedAt;
    }

    struct RoundData {
        bytes32 commitA;
        bytes32 commitB;
        uint8 moveA;
        uint8 moveB;
        bool revealedA;
        bool revealedB;
        uint256 commitDeadline;
        uint256 revealDeadline;
        bool resolved;
    }

    uint256 public matchCount;

    mapping(uint256 => Match) public matches;
    mapping(uint256 => mapping(uint256 => RoundData)) public rounds;


    constructor(address _owner) Ownable(_owner) {}

    function createMatch(address agentA, address agentB, uint256 stakePerRound)
        external
        onlyOwner
        returns (uint256 matchId)
    {
        if (agentA == address(0) || agentB == address(0)) revert ZeroAddress();
        if (agentA == agentB) revert SameAgent();
        if (stakePerRound == 0) revert ZeroStake();

        matchId = matchCount++;

        Match storage m = matches[matchId];
        m.agentA = agentA;
        m.agentB = agentB;
        m.currentRound = 0;
        m.stakePerRound = stakePerRound;
        m.active = true;
        m.startedAt = block.timestamp;

        emit MatchCreated(matchId, agentA, agentB, stakePerRound);

        _startRound(matchId);
    }

    function commitMove(uint256 matchId, bytes32 commitment) external {
        Match storage m = matches[matchId];
        if (!m.active) revert MatchNotActive();

        (bool isA, bool isB) = _getAgentRole(m, msg.sender);
        if (!isA && !isB) revert NotParticipant();

        RoundData storage rd = rounds[matchId][m.currentRound];

        if (block.timestamp > rd.commitDeadline) revert CommitPhaseExpired();

        if (isA) {
            if (rd.commitA != bytes32(0)) revert AlreadyCommitted();
            rd.commitA = commitment;
        } else {
            if (rd.commitB != bytes32(0)) revert AlreadyCommitted();
            rd.commitB = commitment;
        }

        emit MoveCommitted(matchId, m.currentRound, msg.sender);
    }

    function commitMoveFor(uint256 matchId, address agent, bytes32 commitment) external onlyOwner {
        Match storage m = matches[matchId];
        if (!m.active) revert MatchNotActive();

        (bool isA, bool isB) = _getAgentRole(m, agent);
        if (!isA && !isB) revert NotParticipant();

        RoundData storage rd = rounds[matchId][m.currentRound];

        if (block.timestamp > rd.commitDeadline) revert CommitPhaseExpired();

        if (isA) {
            if (rd.commitA != bytes32(0)) revert AlreadyCommitted();
            rd.commitA = commitment;
        } else {
            if (rd.commitB != bytes32(0)) revert AlreadyCommitted();
            rd.commitB = commitment;
        }

        emit MoveCommitted(matchId, m.currentRound, agent);
    }

    function revealMove(uint256 matchId, uint8 move, bytes32 secret) external {
        Match storage m = matches[matchId];
        if (!m.active) revert MatchNotActive();

        (bool isA, bool isB) = _getAgentRole(m, msg.sender);
        if (!isA && !isB) revert NotParticipant();

        if (move != COOPERATE && move != DEFECT) revert InvalidMove();

        RoundData storage rd = rounds[matchId][m.currentRound];

        if (block.timestamp <= rd.commitDeadline) revert NotInRevealPhase();
        if (block.timestamp > rd.revealDeadline) revert RevealPhaseExpired();

        bytes32 expectedHash = keccak256(abi.encodePacked(move, secret));

        if (isA) {
            if (rd.revealedA) revert AlreadyRevealed();
            if (rd.commitA != expectedHash) revert InvalidCommitment();
            rd.moveA = move;
            rd.revealedA = true;
        } else {
            if (rd.revealedB) revert AlreadyRevealed();
            if (rd.commitB != expectedHash) revert InvalidCommitment();
            rd.moveB = move;
            rd.revealedB = true;
        }

        emit MoveRevealed(matchId, m.currentRound, msg.sender, move);
    }

    function revealMoveFor(uint256 matchId, address agent, uint8 move, bytes32 secret) external onlyOwner {
        Match storage m = matches[matchId];
        if (!m.active) revert MatchNotActive();

        (bool isA, bool isB) = _getAgentRole(m, agent);
        if (!isA && !isB) revert NotParticipant();

        if (move != COOPERATE && move != DEFECT) revert InvalidMove();

        RoundData storage rd = rounds[matchId][m.currentRound];

        if (block.timestamp <= rd.commitDeadline) revert NotInRevealPhase();
        if (block.timestamp > rd.revealDeadline) revert RevealPhaseExpired();

        bytes32 expectedHash = keccak256(abi.encodePacked(move, secret));

        if (isA) {
            if (rd.revealedA) revert AlreadyRevealed();
            if (rd.commitA != expectedHash) revert InvalidCommitment();
            rd.moveA = move;
            rd.revealedA = true;
        } else {
            if (rd.revealedB) revert AlreadyRevealed();
            if (rd.commitB != expectedHash) revert InvalidCommitment();
            rd.moveB = move;
            rd.revealedB = true;
        }

        emit MoveRevealed(matchId, m.currentRound, agent, move);
    }

    function resolveRound(uint256 matchId) external onlyOwner {
        Match storage m = matches[matchId];
        if (!m.active) revert MatchNotActive();

        RoundData storage rd = rounds[matchId][m.currentRound];
        if (rd.resolved) revert RoundAlreadyResolved();

        bool bothRevealed = rd.revealedA && rd.revealedB;

        if (!bothRevealed && block.timestamp <= rd.revealDeadline) {
            revert RevealPhaseNotExpired();
        }

        uint8 finalMoveA = _getFinalMove(rd.commitA, rd.revealedA, rd.moveA);
        uint8 finalMoveB = _getFinalMove(rd.commitB, rd.revealedB, rd.moveB);

        (uint256 payA, uint256 payB) = _calculatePayoff(finalMoveA, finalMoveB);

        uint256 roundPayA = payA * m.stakePerRound;
        uint256 roundPayB = payB * m.stakePerRound;
        m.scoreA += roundPayA;
        m.scoreB += roundPayB;
        rd.moveA = finalMoveA;
        rd.moveB = finalMoveB;
        rd.resolved = true;

        emit RoundResolved(matchId, m.currentRound, finalMoveA, finalMoveB, roundPayA, roundPayB);
    }

    function checkGameEnd(uint256 matchId) external onlyOwner {
        Match storage m = matches[matchId];
        if (!m.active) revert MatchNotActive();

        RoundData storage rd = rounds[matchId][m.currentRound];
        if (!rd.resolved) revert RoundNotResolved();

        if (m.currentRound + 1 >= MAX_ROUNDS) {
            _endMatch(matchId, "max_rounds_reached");
            return;
        }

        uint256 randomValue = block.prevrandao % END_PROBABILITY_DENOMINATOR;
        if (randomValue < END_PROBABILITY_NUMERATOR) {
            _endMatch(matchId, "random_termination");
            return;
        }

        m.currentRound += 1;
        _startRound(matchId);
    }

    function forceEndMatch(uint256 matchId, string calldata reason) external onlyOwner {
        Match storage m = matches[matchId];
        if (!m.active) revert MatchNotActive();

        _endMatch(matchId, reason);
    }

    function getMatch(uint256 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    function getRound(uint256 matchId, uint256 round) external view returns (RoundData memory) {
        return rounds[matchId][round];
    }

    function computeCommitment(uint8 move, bytes32 secret) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(move, secret));
    }

    function _startRound(uint256 matchId) internal {
        Match storage m = matches[matchId];
        RoundData storage rd = rounds[matchId][m.currentRound];

        rd.moveA = UNSET;
        rd.moveB = UNSET;
        rd.commitDeadline = block.timestamp + COMMIT_DURATION;
        rd.revealDeadline = block.timestamp + COMMIT_DURATION + REVEAL_DURATION;

        emit RoundStarted(matchId, m.currentRound, rd.commitDeadline, rd.revealDeadline);
    }

    function _getFinalMove(bytes32 commitment, bool revealed, uint8 revealedMove) internal pure returns (uint8) {
        if (commitment == bytes32(0)) {
            return DEFECT;
        }
        if (!revealed) {
            return DEFECT;
        }
        return revealedMove;
    }

    function _calculatePayoff(uint8 moveA, uint8 moveB) internal pure returns (uint256 payA, uint256 payB) {
        if (moveA == COOPERATE && moveB == COOPERATE) {
            payA = PAYOFF_R;
            payB = PAYOFF_R;
        } else if (moveA == DEFECT && moveB == COOPERATE) {
            payA = PAYOFF_T;
            payB = PAYOFF_S;
        } else if (moveA == COOPERATE && moveB == DEFECT) {
            payA = PAYOFF_S;
            payB = PAYOFF_T;
        } else {
            payA = PAYOFF_P;
            payB = PAYOFF_P;
        }
    }

    function _getAgentRole(Match storage m, address caller) internal view returns (bool isA, bool isB) {
        isA = (caller == m.agentA);
        isB = (caller == m.agentB);
    }

    function _endMatch(uint256 matchId, string memory reason) internal {
        Match storage m = matches[matchId];
        m.active = false;

        emit MatchEnded(matchId, m.scoreA, m.scoreB, reason);
    }
}








