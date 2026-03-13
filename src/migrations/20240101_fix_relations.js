'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const u = await queryInterface.describeTable('users');
    if (!u.group_id) {
      await queryInterface.addColumn('users', 'group_id', {
        type: Sequelize.UUID, allowNull: true,
        references: { model: 'groups', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL'
      });
    }
    if (!u.teacher_id) {
      await queryInterface.addColumn('users', 'teacher_id', {
        type: Sequelize.UUID, allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE', onDelete: 'SET NULL'
      });
    }
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'group_id').catch(()=>{});
    await queryInterface.removeColumn('users', 'teacher_id').catch(()=>{});
  }
};