'use strict';

/** Notificaciones in-app (canal `app`): lo que pinta la campana del frontend.
 * Se persisten al consumir el evento, solo si el usuario tiene el canal `app`
 * activo para ese provider — si lo apagó, no hay campana NI historial.
 *
 * La columna se llama `is_read` porque `READ` es palabra reservada en MySQL;
 * el modelo y la API la exponen como `read`. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notifications', {
      id: { type: Sequelize.CHAR(36), allowNull: false, primaryKey: true },
      user_id: { type: Sequelize.CHAR(36), allowNull: false },
      organization_id: { type: Sequelize.CHAR(36), allowNull: true },
      provider_code: { type: Sequelize.STRING(100), allowNull: false },
      // Subconjunto seguro del evento: lo que la campana necesita para pintar
      // el texto y para el deep-link (invoiceId, number, ...).
      payload: { type: Sequelize.JSON, allowNull: true },
      is_read: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // La consulta de la campana es siempre "las de este usuario, primero las no
    // leídas, más recientes arriba".
    await queryInterface.addIndex('notifications', ['user_id', 'is_read', 'created_at'], {
      name: 'idx_notifications_user_read_created',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('notifications', 'idx_notifications_user_read_created');
    await queryInterface.dropTable('notifications');
  },
};
