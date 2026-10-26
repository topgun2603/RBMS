export { ANSWER_KEYS, MAX_ANSWER, COLOURS, COLOUR_NAMES, TRADE_WORDS, guessTrade, tradeScores, splitGroups, colourFrom, moodsFrom, presetFor, extrasFrom, type Answers, type AnswerKey, type TradeGuess } from "./rules";
export { SETUP_FEATURE, SETUP_SYSTEM, SETUP_JSON_SCHEMA, setupOutputZ, readWithModel, answersInput, QUESTION_EN, FALLBACK_CODES, type SetupModelOutput, type ModelReading, type SetupRunner } from "./read";
export { buildProposal, cleanWords, templateHero, type SetupProposal, type ShopContext } from "./proposal";
export { buildHome, isStarterHome, wordsOf } from "./home";
export { planSetup, type ShopState } from "./plan";
export { SetupAssistant, cleanAnswers, SETUP_STATUSES, type SetupDeps, type SetupProgress, type SetupStatus, type SetupSummary } from "./service";
export { setupModule, type SetupRouteDeps } from "./routes";
