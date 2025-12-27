# Contributing to ZKP2P Off-Ramp

Thank you for your interest in contributing to ZKP2P Off-Ramp! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Style Guidelines](#style-guidelines)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please be respectful, inclusive, and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 20+
- Rust 1.75+ (for attestation service)
- Foundry (for smart contracts)
- Git

### Finding Issues to Work On

- Look for issues labeled `good first issue` for beginner-friendly tasks
- Issues labeled `help wanted` are open for community contribution
- Check the project roadmap for larger initiatives

### Before You Start

1. Check if an issue already exists for your proposed change
2. For significant changes, open an issue first to discuss the approach
3. Wait for maintainer feedback before starting major work

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/zkp2p-offramp.git
cd zkp2p-offramp
git remote add upstream https://github.com/original-org/zkp2p-offramp.git
```

### 2. Install Dependencies

```bash
# Contracts
cd contracts && forge install && cd ..

# Solver
cd solver && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

### 3. Set Up Environment

```bash
# Copy example environment files
cp solver/env.example solver/.env
cp frontend/env.example frontend/.env.local
```

### 4. Run Tests

```bash
# Contracts
cd contracts && forge test

# Solver
cd solver && npm test

# Frontend
cd frontend && npm run build
```

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-gbp-support` - New features
- `fix/quote-expiration-bug` - Bug fixes
- `docs/update-readme` - Documentation
- `refactor/provider-interface` - Refactoring

### Commit Messages

Follow conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, no code change
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(solver): add automatic retry queue for failed intents

fix(frontend): resolve quote expiration display bug

docs(readme): update deployment instructions
```

### Keep Commits Atomic

- Each commit should represent a single logical change
- If you need to use "and" in your commit message, consider splitting it

## Submitting Changes

### 1. Sync with Upstream

```bash
git fetch upstream
git rebase upstream/main
```

### 2. Run All Checks

```bash
# Contracts
cd contracts && forge fmt && forge test

# Solver
cd solver && npm run build && npm test

# Frontend
cd frontend && npm run build
```

### 3. Push Your Branch

```bash
git push origin your-branch-name
```

### 4. Open a Pull Request

1. Go to GitHub and open a PR against `main`
2. Fill out the PR template completely
3. Link related issues
4. Request review from maintainers

### 5. Address Feedback

- Respond to all review comments
- Make requested changes
- Push additional commits (don't force-push during review)
- Re-request review when ready

## Style Guidelines

### Solidity

- Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- Use `forge fmt` for formatting
- Add NatSpec comments for all public functions

```solidity
/// @notice Creates a new off-ramp intent
/// @param amount The USDC amount in base units (6 decimals)
/// @param currency The target fiat currency
/// @return intentId The unique identifier for the created intent
function createIntent(
    uint256 amount,
    Currency currency
) external returns (bytes32 intentId);
```

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Use meaningful variable names
- Add JSDoc comments for exported functions

```typescript
/**
 * Generates a quote for an off-ramp intent
 * @param request - The quote request parameters
 * @returns A quote with fiat amount, fee, and timing
 */
async function getQuote(request: QuoteRequest): Promise<Quote> {
  // ...
}
```

### File Organization

- One component/class per file
- Group related files in directories
- Use `index.ts` for clean exports

## Testing

### Smart Contracts

```bash
cd contracts

# Run all tests
forge test

# Run specific test
forge test --match-test testCreateIntent

# Run with verbosity
forge test -vvv

# Run coverage
forge coverage
```

### Solver

```bash
cd solver

# Run tests
npm test

# Run with coverage
npm run test:coverage
```

### Writing Tests

- Test both success and failure cases
- Use descriptive test names
- Mock external dependencies
- Aim for >80% code coverage

```typescript
describe('QontoProvider', () => {
  describe('getQuote', () => {
    it('should return a valid quote for EUR', async () => {
      // ...
    });

    it('should reject amounts exceeding limit', async () => {
      // ...
    });
  });
});
```

## Documentation

### When to Update Docs

- Adding new features
- Changing existing behavior
- Fixing incorrect documentation
- Adding examples

### Documentation Structure

```
docs/
├── architecture/     # System design docs
├── guides/           # How-to guides
└── api/              # API reference
```

### Writing Good Documentation

- Use clear, simple language
- Include code examples
- Keep it up to date with code changes
- Add diagrams for complex concepts

## Questions?

- **Discord**: Join our server for real-time help
- **GitHub Discussions**: For longer-form questions
- **Issues**: For bug reports and feature requests

## Recognition

Contributors are recognized in:
- Release notes
- CONTRIBUTORS.md (for significant contributions)
- Special Discord role

Thank you for contributing to ZKP2P Off-Ramp! 🙏

