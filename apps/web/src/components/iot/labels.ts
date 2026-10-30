import type { ChipRecordType, ChipState } from "@solvex-dergana/shared";

/** The chip's states in French: the strip and the journal both read these, so no English state name reaches the screen. */
export const STATE_LABELS: Record<ChipState, string> = {
  BOOT: "Démarrage",
  IDLE: "Repos",
  ARMED: "Armée",
  IMPACT: "Impact",
  CONFIRM: "Confirmation",
  SEND: "Envoi",
  AWAIT_ACK: "Attente d'accusé",
  DONE: "Terminé",
};

export const RECORD_LABELS: Record<Exclude<ChipRecordType, "state_change">, string> = {
  selftest: "Autotest réussi",
  impact_detected: "Impact détecté",
  impact_rejected: "Impulsion écartée",
  cancel_pressed: "Alerte annulée",
  http_sent: "Envoi par Internet",
  sms_sent: "Envoi par SMS",
  ack_received: "Accusé reçu du serveur",
};
