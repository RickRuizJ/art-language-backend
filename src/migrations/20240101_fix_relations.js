'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();

    // 1. Crear tabla Groups si no existe
    if (!tables.includes('Groups')) {
      await queryInterface.createTable('Groups', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        name: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        teacherId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        isActive: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      console.log('✅ Groups table created');
    } else {
      console.log('⏭️  Groups already exists');
    }

    // 2. Agregar groupId y teacherId a Users si no existen
    if (tables.includes('Users')) {
      const usersDesc = await queryInterface.describeTable('Users');

      if (!usersDesc.groupId) {
        await queryInterface.addColumn('Users', 'groupId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'Groups', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
        console.log('✅ groupId added to Users');
      } else {
        console.log('⏭️  Users.groupId already exists');
      }

      if (!usersDesc.teacherId) {
        await queryInterface.addColumn('Users', 'teacherId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
        console.log('✅ teacherId added to Users');
      } else {
        console.log('⏭️  Users.teacherId already exists');
      }
    }

    // 3. Crear tabla Assignments si no existe, o agregar groupId si ya existe
    if (!tables.includes('Assignments')) {
      await queryInterface.createTable('Assignments', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        title: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        instructions: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        worksheetId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'Worksheets', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        groupId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'Groups', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        teacherId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        dueDate: {
          type: Sequelize.DATE,
          allowNull: true,
        },
        isActive: {
          type: Sequelize.BOOLEAN,
          defaultValue: true,
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      console.log('✅ Assignments table created');
    } else {
      const assignDesc = await queryInterface.describeTable('Assignments');
      if (!assignDesc.groupId) {
        await queryInterface.addColumn('Assignments', 'groupId', {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'Groups', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
        console.log('✅ groupId added to Assignments');
      } else {
        console.log('⏭️  Assignments.groupId already exists');
      }
    }

    // 4. Crear tabla Submissions si no existe
    if (!tables.includes('Submissions')) {
      await queryInterface.createTable('Submissions', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        studentId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'Users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        assignmentId: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'Assignments', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        answers: {
          type: Sequelize.JSONB,
          allowNull: true,
          defaultValue: {},
        },
        score: { type: Sequelize.FLOAT, allowNull: true },
        maxScore: { type: Sequelize.FLOAT, allowNull: true },
        status: {
          type: Sequelize.ENUM('pending', 'in_progress', 'submitted', 'graded'),
          defaultValue: 'pending',
        },
        submittedAt: { type: Sequelize.DATE, allowNull: true },
        feedback: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      console.log('✅ Submissions table created');
    } else {
      console.log('⏭️  Submissions already exists');
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Submissions').catch(() => {});
    await queryInterface.removeColumn('Assignments', 'groupId').catch(() => {});
    await queryInterface.removeColumn('Users', 'groupId').catch(() => {});
    await queryInterface.removeColumn('Users', 'teacherId').catch(() => {});
    await queryInterface.dropTable('Groups').catch(() => {});
  },
};
