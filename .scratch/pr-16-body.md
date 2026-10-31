## Summary

Implements **Issue #16 ("IoT Showcase visuals and presentation mode")** adhering to PRD FR-S8-07, FR-S8-08, FR-S8-09, FR-S8-10, and NFR-S8-1.

### Key Changes
1. **3D Vehicle Twin (`vehicle-twin.tsx`):**
   - Renders a 3D low-poly emergency response vehicle using hardware-accelerated CSS 3D perspective geometry.
   - Rotates strictly with the simulator's orientation filter (`rollDeg`, `pitchDeg`).
   - Unclamped roll allows full 360-degree rollovers (Tonneau scenario).
   - Alternating red/white flashing headlights and chassis during `IMPACT` state.
   - Live orientation HUD overlay with roll/pitch angle readout and vehicle posture badges (`STABLE`, `INCLINÉ`, `TONNEAU`).

2. **Animated Hardware Block Diagram (`block-diagram.tsx`):**
   - High-contrast SVG architecture diagram featuring:
     - Alimentation (12V -> 3.8V DC-DC / LiPo)
     - MCU ESP32-S3 (Dual-Core FreeRTOS)
     - Capteurs IMU (LSM6DSOX)
     - GNSS GPS (NEO-M8N)
     - Modem GSM (SIM800L / Quectel) with live AT command terminal (`AT+CMGS`, `AT+HTTPACTION`, `AT+CSQ`, `IDLE`)
     - RF Antenna radiating pulses during active transmission
   - Signal bus lines animate data flow between active hardware blocks.

3. **Event-Driven Alert Journey Timeline (`journey-timeline.tsx`):**
   - Strictly enforces PRD FR-S8-10: nothing animates or transitions without a real event.
   - Displays measured per-hop latency and total end-to-end journey time across 4 hops:
     1. Puce SVX (Capteur)
     2. Réseau Mobile (GSM / SMS 2G / HTTP 4G)
     3. Serveur SVX (Ingest & Triage)
     4. Poste Dispatcher (Notification temps réel)

4. **Projector & Presentation Mode (`presentation.ts`, `iot-showcase.tsx`):**
   - High-contrast 16:9 dark layout readable at 1280x720 on a projector.
   - Cursor auto-hides after 3 seconds of mouse inactivity in fullscreen presentation mode.
   - Keyboard shortcuts:
     - `F`: Fullscreen toggle
     - `1`–`5`: Scenario trigger
     - `R`: Reset chip
     - `Space`: Cancel alert during 10s CONFIRM window
   - Bilingual French primary / Arabic secondary labels (`dir="rtl"`).

5. **Test Suite:**
   - 17 unit tests across 4 test files (`block-diagram.test.ts`, `journey-timeline.test.ts`, `presentation-mode.test.ts`, `vehicle-twin.test.ts`), all passing.

Closes #16
