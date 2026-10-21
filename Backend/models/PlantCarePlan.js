import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const PlantCarePlan = sequelize.define('plant_care_plan', {
    plant_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        references: { model: 'plants', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    plan: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    },
    source: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'default'
    },
    season: {
        type: DataTypes.STRING(16),
        allowNull: true
    },
    model: {
        type: DataTypes.STRING(64),
        allowNull: true
    },
    generated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'plant_care_plans',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
})

export default PlantCarePlan
