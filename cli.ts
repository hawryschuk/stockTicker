#!/usr/bin/env node
import { Game } from './business/game';
import { ConsoleTerminal } from '@hawryschuk/terminals/ConsoleTerminal';

const terminal = new ConsoleTerminal;
new Game({ terminals: [terminal] }).run();
