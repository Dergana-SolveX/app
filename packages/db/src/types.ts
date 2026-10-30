import type {
  ambulanceUnits,
  appUsers,
  cellTowers,
  deviceCommands,
  dispatches,
  handovers,
  hospitalsMatrix,
  incidentEvents,
  masterIncidents,
  medicAssessments,
  medicalProfiles,
  rawAlerts,
  smsLog,
  vehicles,
  zones,
} from "./schema";

export type MedicalProfile = typeof medicalProfiles.$inferSelect;
export type NewMedicalProfile = typeof medicalProfiles.$inferInsert;
export type Vehicle = typeof vehicles.$inferSelect;
export type CellTower = typeof cellTowers.$inferSelect;
export type SmsLog = typeof smsLog.$inferSelect;
export type DeviceCommand = typeof deviceCommands.$inferSelect;
export type MasterIncident = typeof masterIncidents.$inferSelect;
export type RawAlert = typeof rawAlerts.$inferSelect;
export type NewRawAlert = typeof rawAlerts.$inferInsert;
export type HospitalRow = typeof hospitalsMatrix.$inferSelect;
export type AmbulanceUnit = typeof ambulanceUnits.$inferSelect;
export type Dispatch = typeof dispatches.$inferSelect;
export type MedicAssessment = typeof medicAssessments.$inferSelect;
export type Handover = typeof handovers.$inferSelect;
export type IncidentEvent = typeof incidentEvents.$inferSelect;
export type Zone = typeof zones.$inferSelect;
export type AppUser = typeof appUsers.$inferSelect;
