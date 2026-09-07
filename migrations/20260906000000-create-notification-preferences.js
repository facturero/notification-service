'use strict';

/** Preferencias de notificación por usuario (estilo Moodle): un provider
 * (declarado por un plugin) × canal (app/smtp) con su valor enabled.
 * La PK compuesta impide duplicar (user, provider, channel). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notification_preferences', {
      user_id: { type: Sequelize.CHAR(36), allowNull: false, primaryKey: true },
      provider_code: { type: Sequelize.STRING(100), allowNull: false, primaryKey: true },
      channel: { type: Sequelize.STRING(20), allowNull: false, primaryKey: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notification_preferences');
  },
};