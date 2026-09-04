'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDef = await queryInterface.describeTable('processed_events');
    if (!tableDef.status) {
      await queryInterface.addColumn('processed_events', 'status', {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'processed',
      });
    }
    if (!tableDef.last_error) {
      await queryInterface.addColumn('processed_events', 'last_error', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const tableDef = await queryInterface.describeTable('processed_events');
    if (tableDef.last_error) {
      await queryInterface.removeColumn('processed_events', 'last_error');
    }
    if (tableDef.status) {
      await queryInterface.removeColumn('processed_events', 'status');
    }
  },
};
