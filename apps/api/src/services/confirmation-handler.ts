import { ObjectId } from 'mongodb';
import {
  clearPendingConfirmation,
  completePendingEntityConfirmation,
  getPendingConfirmation,
  isAffirmativeMessage,
  isNegativeMessage,
  upsertPendingConfirmation,
} from './entities.js';
import { getFinanceCollection, getGymCollection } from './db.js';
import {
  buildFinanceDocument,
  buildFinanceAck,
  buildGymDocument,
  buildGymAck,
  extractCreatedEntityNameOverride,
  normalizeText,
  processDbAction,
} from './actions.js';

const USER_ID = 'default';

export interface ConfirmationResult {
  /** Text to return to the user, or null if no pending confirmation was found */
  response: string | null;
}

/**
 * Handles the pending confirmation state machine.
 * Returns the response text when a confirmation is in progress,
 * or null when there is no pending confirmation (normal chat flow).
 */
export async function handlePendingConfirmation(
  userMessage: string,
): Promise<ConfirmationResult> {
  const pendingConfirmation = await getPendingConfirmation(USER_ID);
  if (!pendingConfirmation) return { response: null };

  let pendingResponse = '';

  // --- Data completion (missing hour for past entry) ---
  if (pendingConfirmation.type === 'data_completion') {
    const originalAction = pendingConfirmation.payload.originalAction as any;
    originalAction.data.hour = userMessage.trim();
    const result = await processDbAction(originalAction);
    pendingResponse = result.ack ?? 'He completado el registro.';
    await clearPendingConfirmation(pendingConfirmation._id as ObjectId);

  // --- Affirmative response to a pending create/select ---
  } else if (isAffirmativeMessage(userMessage)) {
    if (
      pendingConfirmation.type === 'finance_create' ||
      pendingConfirmation.type === 'gym_create'
    ) {
      const overrideName = extractCreatedEntityNameOverride(userMessage);
      if (overrideName) {
        pendingConfirmation.payload = {
          ...pendingConfirmation.payload,
          entityName: overrideName,
        };
      }
    }

    const completed = await completePendingEntityConfirmation(pendingConfirmation);

    if (completed.collection === 'finance') {
      if (completed.entryData && (completed.entryData.amount || completed.entryData.concept)) {
        const entry = buildFinanceDocument(
          completed.entryData,
          completed.entityId,
          completed.entityName,
        );
        await getFinanceCollection().insertOne(entry);
        pendingResponse = buildFinanceAck(entry);
      } else {
        pendingResponse = `He creado la categoria "${completed.entityName}" con éxito.`;
      }
    } else if (pendingConfirmation.type === 'finance_select') {
      const text = normalizeText(userMessage);
      const candidates =
        (pendingConfirmation.payload.candidates as { id: string; name: string }[]) || [];
      const numMatch = text.match(/^(\d+)\.?$/);
      const index = numMatch ? parseInt(numMatch[1], 10) - 1 : -1;

      let selected: { id: string; name: string } | null = null;
      if (index >= 0 && index < candidates.length) {
        selected = candidates[index];
      } else {
        selected = candidates.find((c) => normalizeText(c.name) === text) || null;
      }

      if (selected) {
        const entryData =
          (pendingConfirmation.payload.entryData as Record<string, unknown>) || {};
        const entry = buildFinanceDocument(entryData, selected.id, selected.name);
        await getFinanceCollection().insertOne(entry);
        await clearPendingConfirmation(pendingConfirmation._id as ObjectId);
        pendingResponse = buildFinanceAck(entry);
      } else if (
        text.includes('crear') ||
        text.includes('nuevo') ||
        index === candidates.length
      ) {
        const entryData =
          (pendingConfirmation.payload.entryData as Record<string, unknown>) || {};
        const nameToCreate =
          (pendingConfirmation.payload.keyword as string) || 'nueva categoria';
        await upsertPendingConfirmation({
          userId: USER_ID,
          status: 'pending',
          type: 'finance_create',
          prompt: `De acuerdo, crearé la categoria "${nameToCreate}". ¿Confirmas?`,
          payload: { ...pendingConfirmation.payload, entityName: nameToCreate, entryData },
        });
        pendingResponse = `De acuerdo, crearé la categoria "${nameToCreate}". ¿Confirmas?`;
      } else if (isNegativeMessage(userMessage)) {
        await clearPendingConfirmation(pendingConfirmation._id as ObjectId);
        pendingResponse = 'Listo, no hice cambios.';
      } else {
        pendingResponse = `No entendí tu elección. Por favor responde con el número (1-${
          candidates.length + 1
        }), el nombre exacto, o di "crear" para una nueva.`;
      }
    } else {
      // gym_create confirmed -> ask for muscle group
      const overrideName = extractCreatedEntityNameOverride(userMessage);
      const entityName = overrideName || (pendingConfirmation.payload.entityName as string);
      
      await upsertPendingConfirmation({
        userId: USER_ID,
        status: 'pending',
        type: 'gym_muscle_group',
        prompt: `¿A qué grupo muscular pertenece "${entityName}"? (Brazo, Hombro, Pecho, Espalda, Pierna, Abdomen, Cardio, Completo)`,
        payload: { ...pendingConfirmation.payload, entityName },
      });
      pendingResponse = `¿A qué grupo muscular pertenece "${entityName}"? (Brazo, Hombro, Pecho, Espalda, Pierna, Abdomen, Cardio, Completo)`;
    }

  // --- Gym Muscle Group response ---
  } else if (pendingConfirmation.type === 'gym_muscle_group') {
    const text = normalizeText(userMessage);
    const groups = ['brazo', 'hombro', 'pecho', 'espalda', 'pierna', 'abdomen', 'cardio', 'completo'];
    const matchedGroup = groups.find(g => text.includes(g));

    if (matchedGroup) {
      const muscleGroup = matchedGroup.charAt(0).toUpperCase() + matchedGroup.slice(1);
      const entityName = pendingConfirmation.payload.entityName as string;
      const keyword = (pendingConfirmation.payload.keyword as string) || '';
      
      const { createEntity, clearPendingConfirmation } = await import('./entities.js');
      const created = await createEntity('gym', entityName, keyword, { muscleGroup });
      
      const entryData = (pendingConfirmation.payload.entryData as Record<string, unknown>) || {};
      const entry = buildGymDocument(entryData, created.entityId, created.entityName);
      
      // Add muscleGroup to the entry as well for logging
      (entry as any).muscleGroup = muscleGroup;
      
      await getGymCollection().insertOne(entry);
      await clearPendingConfirmation(pendingConfirmation._id as ObjectId);
      pendingResponse = buildGymAck(entry);
    } else {
      pendingResponse = `No identifiqué el grupo muscular. Por favor selecciona uno de: Brazo, Hombro, Pecho, Espalda, Pierna, Abdomen, Cardio, Completo.`;
    }

  // --- Gym selection ---
  } else if (pendingConfirmation.type === 'gym_select') {
    const text = normalizeText(userMessage);
    const candidates =
      (pendingConfirmation.payload.candidates as { id: string; name: string }[]) || [];
    const numMatch = text.match(/^(\d+)\.?$/);
    const index = numMatch ? parseInt(numMatch[1], 10) - 1 : -1;

    let selected: { id: string; name: string } | null = null;
    if (index >= 0 && index < candidates.length) {
      selected = candidates[index];
    } else {
      selected = candidates.find((c) => normalizeText(c.name) === text) || null;
    }

    if (selected) {
      const entryData =
        (pendingConfirmation.payload.entryData as Record<string, unknown>) || {};
      const entry = buildGymDocument(entryData, selected.id, selected.name);
      await getGymCollection().insertOne(entry);
      await clearPendingConfirmation(pendingConfirmation._id as ObjectId);
      pendingResponse = buildGymAck(entry);
    } else if (
      text.includes('crear') ||
      text.includes('new') ||
      text.includes('nuevo') ||
      index === candidates.length
    ) {
      const nameToCreate =
        (pendingConfirmation.payload.keyword as string) || 'nuevo ejercicio';
      await upsertPendingConfirmation({
        userId: USER_ID,
        status: 'pending',
        type: 'gym_create',
        prompt: `De acuerdo, crearé el ejercicio "${nameToCreate}". ¿Confirmas?`,
        payload: { ...pendingConfirmation.payload, entityName: nameToCreate },
      });
      pendingResponse = `De acuerdo, crearé el ejercicio "${nameToCreate}". ¿Confirmas?`;
    } else if (isNegativeMessage(userMessage)) {
      await clearPendingConfirmation(pendingConfirmation._id as ObjectId);
      pendingResponse = 'Listo, no hice cambios.';
    } else {
      pendingResponse = `No entendí tu elección. Por favor responde con el número (1-${candidates.length}), el nombre exacto, o di "crear" para uno nuevo.`;
    }

  // --- Negative response ---
  } else if (isNegativeMessage(userMessage)) {
    await clearPendingConfirmation(pendingConfirmation._id as ObjectId);
    pendingResponse = 'Listo, no hice cambios. Si quieres, dime otra categoria o ejercicio.';

  // --- Re-prompt ---
  } else {
    pendingResponse = `${pendingConfirmation.prompt} Responde solo sí o no para continuar.`;
  }

  return { response: pendingResponse };
}
