import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createStatusServer } from './server.js';

serveStdio(createStatusServer);
