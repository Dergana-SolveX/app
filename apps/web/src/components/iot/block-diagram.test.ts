import { describe, expect, it } from "vitest";
import { getActiveBlocks, getActiveAtCommand } from "./block-diagram";

describe("Animated block diagram logic (FR-S8-08)", () => {
  it("determines active hardware blocks during BOOT", () => {
    const blocks = getActiveBlocks("BOOT");
    expect(blocks.power).toBe(true);
    expect(blocks.mcu).toBe(true);
    expect(blocks.sensors).toBe(false);
    expect(blocks.gnss).toBe(false);
    expect(blocks.modem).toBe(true); // Self test
    expect(blocks.antenna).toBe(false);
  });

  it("determines active hardware blocks during ARMED", () => {
    const blocks = getActiveBlocks("ARMED");
    expect(blocks.power).toBe(true);
    expect(blocks.mcu).toBe(true);
    expect(blocks.sensors).toBe(true); // Sampling IMU
    expect(blocks.gnss).toBe(true); // 3D fix maintained
    expect(blocks.modem).toBe(false);
    expect(blocks.antenna).toBe(false);
  });

  it("determines active hardware blocks during SEND and AWAIT_ACK", () => {
    const blocksSend = getActiveBlocks("SEND");
    expect(blocksSend.power).toBe(true);
    expect(blocksSend.mcu).toBe(true);
    expect(blocksSend.sensors).toBe(true);
    expect(blocksSend.gnss).toBe(true);
    expect(blocksSend.modem).toBe(true);
    expect(blocksSend.antenna).toBe(true); // Transmitting RF waves

    const blocksAck = getActiveBlocks("AWAIT_ACK");
    expect(blocksAck.modem).toBe(true);
    expect(blocksAck.antenna).toBe(true);
  });

  it("displays correct AT command on the modem block based on channel and state", () => {
    // In IDLE or ARMED without active transmission: AT+CSQ (signal quality check)
    expect(getActiveAtCommand({ state: "ARMED", channel: "sms", attempt: 1 })).toBe("AT+CSQ");

    // During SMS SEND
    expect(getActiveAtCommand({ state: "SEND", channel: "sms", attempt: 1 })).toContain("AT+CMGS");

    // During HTTP SEND
    expect(getActiveAtCommand({ state: "SEND", channel: "http", attempt: 1 })).toContain("AT+HTTPACTION");

    // During AWAIT_ACK
    expect(getActiveAtCommand({ state: "AWAIT_ACK", channel: "sms", attempt: 1 })).toBe("AT+CMGL");
    expect(getActiveAtCommand({ state: "AWAIT_ACK", channel: "http", attempt: 1 })).toBe("AT+HTTPREAD");

    // In DONE or IDLE with no activity
    expect(getActiveAtCommand({ state: "DONE", channel: "http", attempt: 1 })).toBe("IDLE");
  });
});
