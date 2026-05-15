process.env.NODE_ENV = "test";
const request = require("supertest");
const app = require("../../src/app");

describe("GET /api/market/session", () => {
  it("returns contract fields for IST / NSE snapshot", async () => {
    const res = await request(app).get("/api/market/session");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      timeZone: "Asia/Kolkata",
      exchangeMic: expect.any(String),
      nseCashSession: {
        openTimeIst: expect.any(String),
        closeTimeIst: expect.any(String),
      },
      squareoffTimeIst: expect.any(String),
    });
    expect(typeof res.body.data.isMarketOpen).toBe("boolean");
    expect(typeof res.body.data.calendarRowPresent).toBe("boolean");
  });
});
