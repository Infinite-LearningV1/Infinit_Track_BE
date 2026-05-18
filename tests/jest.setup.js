// Global test setup for ESM Jest
import { jest } from '@jest/globals';

// Silence noisy logs in tests
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'info').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

// Provide stable environment defaults for FAHP
process.env.FAHP_METHOD = process.env.FAHP_METHOD || 'extent';
