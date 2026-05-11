import { errors } from '@strapi/utils';

/**
 * publication lifecycles
 */

export default {
  async beforeCreate(event: any) {
    await validateMesoMacroAlignment(event);
  },

  async beforeUpdate(event: any) {
    await validateMesoMacroAlignment(event);
  },
};

async function validateMesoMacroAlignment(event: any) {
  const data = event.params?.data;
  const mesoId = extractRelationId(data?.graphMesoPrimary);
  const documentId = event.params?.where?.documentId ?? event.params?.where?.id ?? data?.documentId;

  if (!mesoId) {
    return;
  }

  const publication = documentId
    ? await strapi.db.query('api::publication.publication').findOne({
        where: { documentId },
        populate: {
          graphMacroPrimary: { select: ['id'] },
        },
      })
    : null;

  const macroId = extractRelationId(data?.graphMacroPrimary) ?? publication?.graphMacroPrimary?.id;

  if (!macroId) {
    return;
  }

  const meso = await strapi.db.query('api::graph-meso.graph-meso').findOne({
    where: { id: mesoId },
    populate: {
      macro: {
        select: ['id'],
      },
    },
  });

  if (!meso) {
    throw new errors.ValidationError(`Meso with ID ${mesoId} not found`);
  }

  const mesoMacroId = meso.macro?.id;

  if (mesoMacroId && mesoMacroId !== macroId) {
    throw new errors.ValidationError(
      'The selected meso does not belong to the selected macro. Please change the macro to match the meso parent.'
    );
  }
}

function extractRelationId(value: any) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return extractRelationId(first);
  }

  if (value.connect) {
    return extractRelationId(value.connect);
  }

  if (value.set) {
    return extractRelationId(value.set);
  }

  if (value.id) {
    return value.id;
  }

  if (value.documentId) {
    return value.documentId;
  }

  return null;
}
