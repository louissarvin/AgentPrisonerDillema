// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract BettingPool is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error RoundAlreadyExists();
    error RoundNotFound();
    error RoundAlreadySettled();
    error RoundAlreadyCancelled();
    error BettingClosed();
    error InvalidOutcome();
    error RoundNotSettled();
    error NothingToClaim();
    error AlreadyClaimed();
    error BetTooSmall();
    error BetTooLarge();
    error NotOracle();
    error RoundNotCancelled();
    error DeadlineInPast();
    error NoFeesToCollect();

    enum Outcome {
        NONE,
        BOTH_COOPERATE,
        BOTH_DEFECT,
        MIXED
    }

    struct BettingRound {
        uint256 matchId;
        uint256 roundNumber;
        uint256 poolCooperate;
        uint256 poolDefect;
        uint256 poolMixed;
        Outcome result;
        bool settled;
        bool cancelled;
        uint256 bettingDeadline;
    }

    event BettingRoundOpened(uint256 indexed matchId, uint256 indexed roundNumber, uint256 deadline);
    event BetPlaced(
        uint256 indexed matchId, uint256 indexed roundNumber, address indexed bettor, Outcome prediction, uint256 amount
    );
    event BettingRoundSettled(uint256 indexed matchId, uint256 indexed roundNumber, Outcome outcome, uint256 totalPool);
    event WinningsClaimed(uint256 indexed matchId, uint256 indexed roundNumber, address indexed bettor, uint256 amount);
    event BetRefunded(uint256 indexed matchId, uint256 indexed roundNumber, address indexed bettor, uint256 amount);
    event ProtocolFeeCollected(uint256 amount);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event RoundCancelled(uint256 indexed matchId, uint256 indexed roundNumber);

    IERC20 public constant USDC = IERC20(0x31d0220469e10c4E71834a79b1f276d740d3768F);
    uint256 public constant MIN_BET = 1e6;
    uint256 public constant MAX_BET = 10_000e6;
    uint256 public constant PROTOCOL_FEE_BPS = 500;
    uint256 public constant OPS_FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    address public oracle;
    uint256 public accumulatedFees;

    mapping(bytes32 => BettingRound) public rounds;
    mapping(bytes32 => mapping(address => mapping(Outcome => uint256))) public bets;
    mapping(bytes32 => mapping(address => bool)) public claimed;
    mapping(bytes32 => mapping(address => bool)) public refunded;

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    constructor(address _owner, address _oracle) Ownable(_owner) {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
    }

    function openBettingRound(uint256 matchId, uint256 roundNumber, uint256 deadline) external onlyOracle {
        if (deadline <= block.timestamp) revert DeadlineInPast();

        bytes32 key = _roundKey(matchId, roundNumber);
        if (rounds[key].bettingDeadline != 0) revert RoundAlreadyExists();

        rounds[key] = BettingRound({
            matchId: matchId,
            roundNumber: roundNumber,
            poolCooperate: 0,
            poolDefect: 0,
            poolMixed: 0,
            result: Outcome.NONE,
            settled: false,
            cancelled: false,
            bettingDeadline: deadline
        });

        emit BettingRoundOpened(matchId, roundNumber, deadline);
    }

    function settleBettingRound(uint256 matchId, uint256 roundNumber, Outcome outcome) external onlyOracle {
        if (outcome == Outcome.NONE) revert InvalidOutcome();

        bytes32 key = _roundKey(matchId, roundNumber);
        BettingRound storage round = rounds[key];

        if (round.bettingDeadline == 0) revert RoundNotFound();
        if (round.settled) revert RoundAlreadySettled();
        if (round.cancelled) revert RoundAlreadyCancelled();

        round.result = outcome;
        round.settled = true;

        uint256 totalPool = round.poolCooperate + round.poolDefect + round.poolMixed;
        uint256 winningPool = _getPoolForOutcome(round, outcome);

        if (winningPool == 0 && totalPool > 0) {
            uint256 opsFee = (totalPool * OPS_FEE_BPS) / BPS_DENOMINATOR;
            accumulatedFees += opsFee;
        } else if (winningPool > 0) {
            uint256 protocolFee = (totalPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
            accumulatedFees += protocolFee;
        }

        emit BettingRoundSettled(matchId, roundNumber, outcome, totalPool);
    }

    function cancelBettingRound(uint256 matchId, uint256 roundNumber) external onlyOracle {
        bytes32 key = _roundKey(matchId, roundNumber);
        BettingRound storage round = rounds[key];

        if (round.bettingDeadline == 0) revert RoundNotFound();
        if (round.settled) revert RoundAlreadySettled();
        if (round.cancelled) revert RoundAlreadyCancelled();

        round.cancelled = true;

        emit RoundCancelled(matchId, roundNumber);
    }

    function placeBet(uint256 matchId, uint256 roundNumber, Outcome prediction, uint256 amount)
        external
        nonReentrant
    {
        if (prediction == Outcome.NONE) revert InvalidOutcome();
        if (amount < MIN_BET) revert BetTooSmall();
        if (amount > MAX_BET) revert BetTooLarge();

        bytes32 key = _roundKey(matchId, roundNumber);
        BettingRound storage round = rounds[key];

        if (round.bettingDeadline == 0) revert RoundNotFound();
        if (block.timestamp >= round.bettingDeadline) revert BettingClosed();
        if (round.settled) revert RoundAlreadySettled();
        if (round.cancelled) revert RoundAlreadyCancelled();

        bets[key][msg.sender][prediction] += amount;

        if (prediction == Outcome.BOTH_COOPERATE) {
            round.poolCooperate += amount;
        } else if (prediction == Outcome.BOTH_DEFECT) {
            round.poolDefect += amount;
        } else {
            round.poolMixed += amount;
        }

        emit BetPlaced(matchId, roundNumber, msg.sender, prediction, amount);

        USDC.safeTransferFrom(msg.sender, address(this), amount);
    }

    function claimWinnings(uint256 matchId, uint256 roundNumber) external nonReentrant {
        bytes32 key = _roundKey(matchId, roundNumber);
        BettingRound storage round = rounds[key];

        if (!round.settled) revert RoundNotSettled();
        if (claimed[key][msg.sender]) revert AlreadyClaimed();

        Outcome outcome = round.result;
        uint256 winningPool = _getPoolForOutcome(round, outcome);
        uint256 totalPool = round.poolCooperate + round.poolDefect + round.poolMixed;

        uint256 payout;

        if (winningPool == 0) {
            uint256 userTotal = bets[key][msg.sender][Outcome.BOTH_COOPERATE]
                + bets[key][msg.sender][Outcome.BOTH_DEFECT] + bets[key][msg.sender][Outcome.MIXED];

            if (userTotal == 0) revert NothingToClaim();

            uint256 opsFee = (totalPool * OPS_FEE_BPS) / BPS_DENOMINATOR;
            uint256 distributable = totalPool - opsFee;
            payout = (userTotal * distributable) / totalPool;
        } else {
            uint256 userBet = bets[key][msg.sender][outcome];
            if (userBet == 0) revert NothingToClaim();

            uint256 protocolFee = (totalPool * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
            uint256 distributable = totalPool - protocolFee;

            payout = (userBet * distributable) / winningPool;
        }

        claimed[key][msg.sender] = true;

        emit WinningsClaimed(matchId, roundNumber, msg.sender, payout);

        USDC.safeTransfer(msg.sender, payout);
    }

    function refundBet(uint256 matchId, uint256 roundNumber) external nonReentrant {
        bytes32 key = _roundKey(matchId, roundNumber);
        BettingRound storage round = rounds[key];

        if (!round.cancelled) revert RoundNotCancelled();
        if (refunded[key][msg.sender]) revert AlreadyClaimed();

        uint256 userTotal = bets[key][msg.sender][Outcome.BOTH_COOPERATE]
            + bets[key][msg.sender][Outcome.BOTH_DEFECT] + bets[key][msg.sender][Outcome.MIXED];

        if (userTotal == 0) revert NothingToClaim();

        refunded[key][msg.sender] = true;

        emit BetRefunded(matchId, roundNumber, msg.sender, userTotal);

        USDC.safeTransfer(msg.sender, userTotal);
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        address oldOracle = oracle;
        oracle = newOracle;
        emit OracleUpdated(oldOracle, newOracle);
    }

    function collectFees() external onlyOwner nonReentrant {
        uint256 fees = accumulatedFees;
        if (fees == 0) revert NoFeesToCollect();

        accumulatedFees = 0;

        emit ProtocolFeeCollected(fees);

        USDC.safeTransfer(owner(), fees);
    }

    function getRound(uint256 matchId, uint256 roundNumber) external view returns (BettingRound memory) {
        return rounds[_roundKey(matchId, roundNumber)];
    }

    function getUserBet(uint256 matchId, uint256 roundNumber, address bettor, Outcome prediction)
        external
        view
        returns (uint256)
    {
        return bets[_roundKey(matchId, roundNumber)][bettor][prediction];
    }

    function getTotalPool(uint256 matchId, uint256 roundNumber) external view returns (uint256) {
        bytes32 key = _roundKey(matchId, roundNumber);
        BettingRound storage round = rounds[key];
        return round.poolCooperate + round.poolDefect + round.poolMixed;
    }

    function getRoundKey(uint256 matchId, uint256 roundNumber) external pure returns (bytes32) {
        return _roundKey(matchId, roundNumber);
    }

    function _roundKey(uint256 matchId, uint256 roundNumber) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(matchId, roundNumber));
    }

    function _getPoolForOutcome(BettingRound storage round, Outcome outcome) internal view returns (uint256) {
        if (outcome == Outcome.BOTH_COOPERATE) return round.poolCooperate;
        if (outcome == Outcome.BOTH_DEFECT) return round.poolDefect;
        if (outcome == Outcome.MIXED) return round.poolMixed;
        return 0;
    }
}




