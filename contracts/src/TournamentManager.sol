// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract TournamentManager is ReentrancyGuard, Ownable2Step, Pausable {
    enum TournamentStatus {
        REGISTRATION,
        ACTIVE,
        COMPLETED,
        CANCELLED
    }

    struct Tournament {
        uint256 id;
        TournamentStatus status;
        uint256 entryFee;
        uint256 prizePool;
        uint256 maxAgents;
        uint256 stakePerRound;
        uint256 registrationDeadline;
        uint256 createdAt;
    }

    struct AgentStats {
        address agentAddress;
        uint256 totalScore;
        uint256 matchesPlayed;
        uint256 cooperations;
        uint256 defections;
        bool registered;
    }

    error ZeroAddress();
    error ZeroAmount();
    error InvalidMaxAgents();
    error InvalidDeadline();
    error TournamentNotFound();
    error TournamentNotInRegistration();
    error TournamentNotActive();
    error TournamentNotCompleted();
    error RegistrationClosed();
    error TournamentFull();
    error AlreadyRegistered();
    error IncorrectEntryFee();
    error InsufficientAgents();
    error NotGameManager();
    error AgentNotRegistered();
    error MatchAlreadyReported();
    error NoPrizeToClaim();
    error TransferFailed();
    error CannotCancelActiveTournament();
    error TournamentAlreadyCompleted();
    error AgentsAreTheSame();
    error TournamentNotFullyPlayed();
    error MaxAgentsTooHigh();

    event TournamentCreated(uint256 indexed tournamentId, uint256 entryFee, uint256 maxAgents);
    event AgentRegistered(uint256 indexed tournamentId, address indexed agent, uint256 entryFee);
    event TournamentStarted(uint256 indexed tournamentId, uint256 agentCount);
    event MatchResultReported(
        uint256 indexed tournamentId, address indexed agentA, address indexed agentB, uint256 scoreA, uint256 scoreB
    );
    event TournamentCompleted(uint256 indexed tournamentId, address winner, uint256 prizePool);
    event PrizeClaimed(uint256 indexed tournamentId, address indexed agent, uint256 amount);
    event TournamentCancelled(uint256 indexed tournamentId);
    event GameManagerUpdated(address indexed oldGameManager, address indexed newGameManager);

    uint256 public constant FIRST_PLACE_BPS = 5000;
    uint256 public constant SECOND_PLACE_BPS = 3000;
    uint256 public constant THIRD_PLACE_BPS = 2000;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MIN_AGENTS = 2;
    uint256 public constant MAX_AGENTS_CAP = 64;

    address public gameManager;
    uint256 public nextTournamentId;

    mapping(uint256 => Tournament) public tournaments;
    mapping(uint256 => address[]) public tournamentAgents;
    mapping(uint256 => mapping(address => AgentStats)) public agentStats;
    mapping(uint256 => mapping(address => mapping(address => bool))) public matchReported;
    mapping(uint256 => mapping(address => uint256)) public pendingPrizes;
    mapping(uint256 => uint256) public matchesCompleted;
    mapping(uint256 => uint256) public totalMatchesExpected;

    constructor(address _owner, address _gameManager) Ownable(_owner) {
        if (_owner == address(0)) revert ZeroAddress();
        if (_gameManager == address(0)) revert ZeroAddress();
        gameManager = _gameManager;
    }

    modifier onlyGameManager() {
        if (msg.sender != gameManager) revert NotGameManager();
        _;
    }

    function createTournament(uint256 entryFee, uint256 maxAgents, uint256 stakePerRound, uint256 registrationDeadline)
        external
        onlyOwner
        whenNotPaused
        returns (uint256 tournamentId)
    {
        if (maxAgents < MIN_AGENTS) revert InvalidMaxAgents();
        if (maxAgents > MAX_AGENTS_CAP) revert MaxAgentsTooHigh();
        if (registrationDeadline <= block.timestamp) revert InvalidDeadline();

        tournamentId = nextTournamentId++;

        tournaments[tournamentId] = Tournament({
            id: tournamentId,
            status: TournamentStatus.REGISTRATION,
            entryFee: entryFee,
            prizePool: 0,
            maxAgents: maxAgents,
            stakePerRound: stakePerRound,
            registrationDeadline: registrationDeadline,
            createdAt: block.timestamp
        });

        emit TournamentCreated(tournamentId, entryFee, maxAgents);
    }

    function startTournament(uint256 tournamentId) external onlyOwner {
        Tournament storage t = tournaments[tournamentId];
        if (t.status != TournamentStatus.REGISTRATION) revert TournamentNotInRegistration();

        uint256 agentCount = tournamentAgents[tournamentId].length;
        if (agentCount < MIN_AGENTS) revert InsufficientAgents();

        t.status = TournamentStatus.ACTIVE;

        totalMatchesExpected[tournamentId] = (agentCount * (agentCount - 1)) / 2;

        emit TournamentStarted(tournamentId, agentCount);
    }

    function completeTournament(uint256 tournamentId) external onlyOwner nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        if (t.status != TournamentStatus.ACTIVE) revert TournamentNotActive();
        if (matchesCompleted[tournamentId] < totalMatchesExpected[tournamentId]) {
            revert TournamentNotFullyPlayed();
        }

        t.status = TournamentStatus.COMPLETED;

        address[] memory leaderboard = _getSortedLeaderboard(tournamentId);
        uint256 prizePool = t.prizePool;
        uint256 agentCount = leaderboard.length;

        if (agentCount == 0) {
            emit TournamentCompleted(tournamentId, address(0), prizePool);
            return;
        }

        if (agentCount == 1) {
            pendingPrizes[tournamentId][leaderboard[0]] = prizePool;
        } else if (agentCount == 2) {
            uint256 firstPrize = (prizePool * 6000) / BPS_DENOMINATOR;
            uint256 secondPrize = prizePool - firstPrize;
            pendingPrizes[tournamentId][leaderboard[0]] = firstPrize;
            pendingPrizes[tournamentId][leaderboard[1]] = secondPrize;
        } else {
            uint256 firstPrize = (prizePool * FIRST_PLACE_BPS) / BPS_DENOMINATOR;
            uint256 secondPrize = (prizePool * SECOND_PLACE_BPS) / BPS_DENOMINATOR;
            uint256 thirdPrize = prizePool - firstPrize - secondPrize;

            pendingPrizes[tournamentId][leaderboard[0]] = firstPrize;
            pendingPrizes[tournamentId][leaderboard[1]] = secondPrize;
            pendingPrizes[tournamentId][leaderboard[2]] = thirdPrize;
        }

        emit TournamentCompleted(tournamentId, leaderboard[0], prizePool);
    }

    function cancelTournament(uint256 tournamentId) external onlyOwner nonReentrant {
        Tournament storage t = tournaments[tournamentId];
        if (t.status == TournamentStatus.COMPLETED) revert TournamentAlreadyCompleted();
        if (t.status == TournamentStatus.CANCELLED) revert TournamentAlreadyCompleted();

        t.status = TournamentStatus.CANCELLED;

        address[] storage agents = tournamentAgents[tournamentId];
        uint256 entryFee = t.entryFee;
        uint256 agentCount = agents.length;

        for (uint256 i; i < agentCount;) {
            pendingPrizes[tournamentId][agents[i]] = entryFee;
            unchecked {
                ++i;
            }
        }

        emit TournamentCancelled(tournamentId);
    }

    function setGameManager(address _newGameManager) external onlyOwner {
        if (_newGameManager == address(0)) revert ZeroAddress();
        address oldGameManager = gameManager;
        gameManager = _newGameManager;
        emit GameManagerUpdated(oldGameManager, _newGameManager);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function registerAgent(uint256 tournamentId) external payable whenNotPaused {
        Tournament storage t = tournaments[tournamentId];
        if (t.status != TournamentStatus.REGISTRATION) revert TournamentNotInRegistration();
        if (block.timestamp > t.registrationDeadline) revert RegistrationClosed();
        if (tournamentAgents[tournamentId].length >= t.maxAgents) revert TournamentFull();
        if (agentStats[tournamentId][msg.sender].registered) revert AlreadyRegistered();
        if (msg.value != t.entryFee) revert IncorrectEntryFee();

        agentStats[tournamentId][msg.sender] = AgentStats({
            agentAddress: msg.sender,
            totalScore: 0,
            matchesPlayed: 0,
            cooperations: 0,
            defections: 0,
            registered: true
        });

        tournamentAgents[tournamentId].push(msg.sender);
        t.prizePool += msg.value;

        emit AgentRegistered(tournamentId, msg.sender, msg.value);
    }

    function claimPrize(uint256 tournamentId) external nonReentrant {
        uint256 amount = pendingPrizes[tournamentId][msg.sender];
        if (amount == 0) revert NoPrizeToClaim();

        pendingPrizes[tournamentId][msg.sender] = 0;

        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PrizeClaimed(tournamentId, msg.sender, amount);
    }

    function reportMatchResult(
        uint256 tournamentId,
        address agentA,
        address agentB,
        uint256 scoreA,
        uint256 scoreB,
        uint256 cooperationsA,
        uint256 defectionsA,
        uint256 cooperationsB,
        uint256 defectionsB
    ) external onlyGameManager {
        Tournament storage t = tournaments[tournamentId];
        if (t.status != TournamentStatus.ACTIVE) revert TournamentNotActive();
        if (agentA == agentB) revert AgentsAreTheSame();
        if (!agentStats[tournamentId][agentA].registered) revert AgentNotRegistered();
        if (!agentStats[tournamentId][agentB].registered) revert AgentNotRegistered();

        (address first, address second) = agentA < agentB ? (agentA, agentB) : (agentB, agentA);
        if (matchReported[tournamentId][first][second]) revert MatchAlreadyReported();

        matchReported[tournamentId][first][second] = true;
        matchesCompleted[tournamentId]++;

        AgentStats storage statsA = agentStats[tournamentId][agentA];
        statsA.totalScore += scoreA;
        statsA.matchesPlayed++;
        statsA.cooperations += cooperationsA;
        statsA.defections += defectionsA;

        AgentStats storage statsB = agentStats[tournamentId][agentB];
        statsB.totalScore += scoreB;
        statsB.matchesPlayed++;
        statsB.cooperations += cooperationsB;
        statsB.defections += defectionsB;

        emit MatchResultReported(tournamentId, agentA, agentB, scoreA, scoreB);
    }

    function getLeaderboard(uint256 tournamentId) external view returns (AgentStats[] memory sorted) {
        address[] memory agents = tournamentAgents[tournamentId];
        uint256 agentCount = agents.length;

        sorted = new AgentStats[](agentCount);
        for (uint256 i; i < agentCount;) {
            sorted[i] = agentStats[tournamentId][agents[i]];
            unchecked {
                ++i;
            }
        }

        for (uint256 i = 1; i < agentCount;) {
            AgentStats memory key = sorted[i];
            uint256 j = i;
            while (j > 0 && sorted[j - 1].totalScore < key.totalScore) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = key;
            unchecked {
                ++i;
            }
        }
    }

    function getTournament(uint256 tournamentId) external view returns (Tournament memory) {
        return tournaments[tournamentId];
    }

    function getTournamentAgents(uint256 tournamentId) external view returns (address[] memory) {
        return tournamentAgents[tournamentId];
    }

    function getAgentStats(uint256 tournamentId, address agent) external view returns (AgentStats memory) {
        return agentStats[tournamentId][agent];
    }

    function getAgentCount(uint256 tournamentId) external view returns (uint256) {
        return tournamentAgents[tournamentId].length;
    }

    function isMatchReported(uint256 tournamentId, address agentA, address agentB) external view returns (bool) {
        (address first, address second) = agentA < agentB ? (agentA, agentB) : (agentB, agentA);
        return matchReported[tournamentId][first][second];
    }

    function getClaimablePrize(uint256 tournamentId, address agent) external view returns (uint256) {
        return pendingPrizes[tournamentId][agent];
    }

    function _getSortedLeaderboard(uint256 tournamentId) internal view returns (address[] memory sorted) {
        address[] memory agents = tournamentAgents[tournamentId];
        uint256 agentCount = agents.length;

        sorted = new address[](agentCount);
        for (uint256 i; i < agentCount;) {
            sorted[i] = agents[i];
            unchecked {
                ++i;
            }
        }

        for (uint256 i = 1; i < agentCount;) {
            address key = sorted[i];
            uint256 keyScore = agentStats[tournamentId][key].totalScore;
            uint256 j = i;
            while (j > 0 && agentStats[tournamentId][sorted[j - 1]].totalScore < keyScore) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = key;
            unchecked {
                ++i;
            }
        }
    }
}
