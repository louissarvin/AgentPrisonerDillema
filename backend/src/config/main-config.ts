/**
 * Centralized configuration for the application
 * All commonly used environment variables should be defined here
 */

// Validate required environment variables on startup
const requiredEnvVars: string[] = ['DATABASE_URL', 'JWT_SECRET'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// App Configuration
export const APP_PORT: number = Number(process.env.APP_PORT) || 3700;
export const NODE_ENV: string = process.env.NODE_ENV || 'development';
export const IS_DEV: boolean = NODE_ENV === 'development';
export const IS_PROD: boolean = NODE_ENV === 'production';

// Database
export const DATABASE_URL: string = process.env.DATABASE_URL as string;

// Authentication
export const JWT_SECRET: string = process.env.JWT_SECRET as string;
export const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d';

// 0G Network
export const ZG_PRIVATE_KEY: string = process.env.ZG_PRIVATE_KEY || '';
export const ZG_RPC_URL: string = process.env.ZG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
export const ZG_INDEXER_URL: string = process.env.ZG_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';
export const ZG_FLOW_ADDRESS: string = process.env.ZG_FLOW_ADDRESS || '0x22E03a6A89B950F1c82ec5e74F8eCa321a105296';

// Contract Addresses (0G Galileo)
export const GAME_MANAGER_ADDRESS: string = process.env.GAME_MANAGER_ADDRESS || '0xc346333ea7Dc98FDDF752FdBd5928CE2460a8C7B';
export const TOURNAMENT_MANAGER_ADDRESS: string = process.env.TOURNAMENT_MANAGER_ADDRESS || '0xc09F776FA193692D56fc8F414817218f986b8330';

// Contract Addresses (Unichain Sepolia)
// BETTING_POOL_ADDRESS: Update after deploying BettingPool.sol to Unichain Sepolia (chain 1301)
export const BETTING_POOL_ADDRESS: string = process.env.BETTING_POOL_ADDRESS || '0xc09F776FA193692D56fc8F414817218f986b8330';
export const UNICHAIN_RPC_URL: string = process.env.UNICHAIN_RPC_URL || 'https://unichain-sepolia-rpc.publicnode.com';
export const UNICHAIN_OPERATOR_KEY: string = process.env.UNICHAIN_OPERATOR_KEY || process.env.ZG_PRIVATE_KEY || '';
export const UNICHAIN_USDC_ADDRESS: string = process.env.UNICHAIN_USDC_ADDRESS || '0x31d0220469e10c4E71834a79b1f276d740d3768F';

// Uniswap API
export const UNISWAP_API_KEY: string = process.env.UNISWAP_API_KEY || '';

// Agent Wallet Encryption & Funding
export const AGENT_ENCRYPTION_KEY: string = process.env.AGENT_ENCRYPTION_KEY || 'dev-encryption-key-change-in-prod';
export const UNICHAIN_FUNDER_PRIVATE_KEY: string = process.env.UNICHAIN_FUNDER_PRIVATE_KEY || '';

// AXL Configuration
export const AXL_HUB_PORT: number = Number(process.env.AXL_HUB_PORT) || 9002;
export const AXL_AGENT_PORTS: number[] = (process.env.AXL_AGENT_PORTS || '9012,9022,9032,9042,9052')
  .split(',').map(p => parseInt(p.trim(), 10));
export const AXL_ROUTER_PORT: number = Number(process.env.AXL_ROUTER_PORT) || 9003;
export const AXL_MCP_SERVICE_PORT: number = Number(process.env.AXL_MCP_SERVICE_PORT) || 7100;

// Error Log Configuration
export const ERROR_LOG_MAX_RECORDS: number = 10000;
export const ERROR_LOG_CLEANUP_INTERVAL: string = '0 * * * *';

// Export all as default object for convenience
export default {
  APP_PORT,
  NODE_ENV,
  IS_DEV,
  IS_PROD,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ZG_PRIVATE_KEY,
  ZG_RPC_URL,
  ZG_INDEXER_URL,
  ZG_FLOW_ADDRESS,
  GAME_MANAGER_ADDRESS,
  TOURNAMENT_MANAGER_ADDRESS,
  BETTING_POOL_ADDRESS,
  UNICHAIN_RPC_URL,
  UNICHAIN_OPERATOR_KEY,
  UNICHAIN_USDC_ADDRESS,
  UNISWAP_API_KEY,
  AGENT_ENCRYPTION_KEY,
  UNICHAIN_FUNDER_PRIVATE_KEY,
  AXL_HUB_PORT,
  AXL_AGENT_PORTS,
  AXL_ROUTER_PORT,
  AXL_MCP_SERVICE_PORT,
  ERROR_LOG_MAX_RECORDS,
  ERROR_LOG_CLEANUP_INTERVAL,
};
