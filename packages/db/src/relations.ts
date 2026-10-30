import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = {
  ...defineRelations(schema, (r) => ({
    medicalProfiles: {
      vehicles: r.many.vehicles({
        from: r.medicalProfiles.id,
        to: r.vehicles.ownerProfileId,
      }),
    },
    vehicles: {
      owner: r.one.medicalProfiles({
        from: r.vehicles.ownerProfileId,
        to: r.medicalProfiles.id,
      }),
    },
    masterIncidents: {
      alerts: r.many.rawAlerts({
        from: r.masterIncidents.id,
        to: r.rawAlerts.incidentId,
      }),
      dispatches: r.many.dispatches({
        from: r.masterIncidents.id,
        to: r.dispatches.incidentId,
      }),
      assessments: r.many.medicAssessments({
        from: r.masterIncidents.id,
        to: r.medicAssessments.incidentId,
      }),
      events: r.many.incidentEvents({
        from: r.masterIncidents.id,
        to: r.incidentEvents.incidentId,
      }),
    },
    rawAlerts: {
      incident: r.one.masterIncidents({
        from: r.rawAlerts.incidentId,
        to: r.masterIncidents.id,
      }),
      profile: r.one.medicalProfiles({
        from: r.rawAlerts.profileId,
        to: r.medicalProfiles.id,
      }),
      vehicle: r.one.vehicles({
        from: r.rawAlerts.vehicleId,
        to: r.vehicles.id,
      }),
    },
    dispatches: {
      incident: r.one.masterIncidents({
        from: r.dispatches.incidentId,
        to: r.masterIncidents.id,
      }),
    },
    incidentEvents: {
      incident: r.one.masterIncidents({
        from: r.incidentEvents.incidentId,
        to: r.masterIncidents.id,
      }),
    },
    medicAssessments: {
      incident: r.one.masterIncidents({
        from: r.medicAssessments.incidentId,
        to: r.masterIncidents.id,
      }),
      dispatch: r.one.dispatches({
        from: r.medicAssessments.dispatchId,
        to: r.dispatches.id,
      }),
      unit: r.one.ambulanceUnits({
        from: r.medicAssessments.unitId,
        to: r.ambulanceUnits.id,
      }),
      profile: r.one.medicalProfiles({
        from: r.medicAssessments.profileId,
        to: r.medicalProfiles.id,
      }),
      recHospital: r.one.hospitalsMatrix({
        from: r.medicAssessments.recHospitalId,
        to: r.hospitalsMatrix.id,
        alias: "assessmentRecHospital",
      }),
      chosenHospital: r.one.hospitalsMatrix({
        from: r.medicAssessments.chosenHospitalId,
        to: r.hospitalsMatrix.id,
        alias: "assessmentChosenHospital",
      }),
      handovers: r.many.handovers({
        from: r.medicAssessments.id,
        to: r.handovers.assessmentId,
      }),
    },
    handovers: {
      assessment: r.one.medicAssessments({
        from: r.handovers.assessmentId,
        to: r.medicAssessments.id,
      }),
      hospital: r.one.hospitalsMatrix({
        from: r.handovers.hospitalId,
        to: r.hospitalsMatrix.id,
      }),
    },
    appUsers: {
      unit: r.one.ambulanceUnits({
        from: r.appUsers.unitId,
        to: r.ambulanceUnits.id,
      }),
      hospital: r.one.hospitalsMatrix({
        from: r.appUsers.hospitalId,
        to: r.hospitalsMatrix.id,
      }),
    },
  })),
  ...schema.authRelations,
};
