require("dotenv").config(); // Load environment variables
const http = require("http");
const app = require("./app"); // Import the Express app
const { attachLiveQuoteWebSocket } = require("./infra/liveQuoteWs");
const connectDB = require("./config/db"); // Import the database connection function
const logger = require("./utils/logger");
const stopLossMonitor = require("./services/stopLossMonitor.service");
const { startSquareOffQueueOrPoll } = require("./queue/squareoff.schedule");
const { startOutboxWorker } = require("./workers/outbox.worker");
const { startSweeper } = require("./services/sweeper.service");
const { startExecutionExecutor } = require("./services/execution.executor");
const { startMarketCalendarWorker } = require("./workers/marketCalendar.worker");
const { isRedisAvailable } = require("./infra/redisHealth");
const redisClient = require("./utils/redisClient");
const runtimeState = require("./infra/runtimeState");

const PORT = process.env.PORT || 8080; // Define the port

/**
 * P1-C: Outbox, stop-loss monitor, execution executor, and sweeper are started in-process.
 * Deploy **one** web instance until background work uses BullMQ-only or distributed locks.
 * @see docs/BACKGROUND_WORKERS_SCALE.md
 */

/**
 * Start the server
 */
const startStopLossMonitor = async () => {
  await stopLossMonitor.start();
};

const startServer = async () => {
  try {
    await connectDB(); // Connect to MongoDB

    // Calendar worker must start BEFORE market-sensitive services so that
    // isMarketOpen() has a populated cache when the SL monitor first ticks.
    // startMarketCalendarWorker() awaits the first DB cache read (fast) and
    // runs the Docker sync asynchronously in background (non-blocking).
    if (process.env.NODE_ENV !== "test") {
      await startMarketCalendarWorker();
      runtimeState.mark("marketCalendarWorker", true);
    }

    await startStopLossMonitor();
    runtimeState.mark("stopLossMonitor", true);
    await startSquareOffQueueOrPoll();
    startOutboxWorker();
    runtimeState.mark("outboxWorker", true);

    if (process.env.NODE_ENV !== "test") {
      logger.info({
        service: "server",
        step: "BACKGROUND_WORKERS_P1C",
        status: "INFO",
        data: {
          message:
            "Process-local timers active (outbox, SL monitor, sweeper, execution executor). Use a single web instance or read docs/BACKGROUND_WORKERS_SCALE.md before horizontal scale.",
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Pending-order workers do not require Redis and must remain active in degraded mode.
    if (process.env.NODE_ENV !== "test") {
      startSweeper();
      runtimeState.mark("sweeper", true);
      startExecutionExecutor();
      runtimeState.mark("executionExecutor", true);
    }

    // Reflection worker is Redis-backed and remains optional in degraded mode.
    if (isRedisAvailable() && redisClient.supportsBullMQ && process.env.NODE_ENV !== "test") {
      require("./queue/workers/reflection.worker");
    } else if (process.env.NODE_ENV !== "test") {
      logger.warn({
        service: "server",
        step: "WORKER_STARTUP",
        status: "WARN",
        data: { message: "Redis-dependent workers in degraded mode (Redis unavailable)." },
        timestamp: new Date().toISOString(),
      });
    }

    const httpServer = http.createServer(app);
    attachLiveQuoteWebSocket(httpServer);

    httpServer.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        logger.error({
          service: "server",
          step: "LISTEN",
          status: "FAILURE",
          data: {
            port: PORT,
            message: `Port ${PORT} is already in use. Stop the other Node process (or change PORT) and restart.`,
          },
          timestamp: new Date().toISOString(),
        });
        process.exit(1);
        return;
      }
      throw err;
    });

    httpServer.listen(PORT, () => {
      logger.info({
        service: "server",
        step: "LISTEN",
        status: "SUCCESS",
        data: { port: PORT },
        timestamp: new Date().toISOString(),
      });
    });
  } catch (error) {
    logger.error({
      service: "server",
      step: "START_FAILED",
      status: "FAILURE",
      data: { message: error.message },
      timestamp: new Date().toISOString(),
    });
    process.exit(1); // Exit with failure
  }
};

startServer();
