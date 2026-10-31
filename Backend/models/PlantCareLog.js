import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const PlantCareLog = sequelize.define('plant_care_log', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
    },
    plant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'plants', key: 'id' },
        onDelete: 'CASCADE'
    },
    action_code: {
        type: DataTypes.STRING(32),
        allowNull: false
    },
    product_name: {
        type: DataTypes.STRING(160),
        allowNull: true
    },
    dose: {
        type: DataTypes.STRING(120),
        allowNull: true
    },
    method: {
        type: DataTypes.STRING(32),
        allowNull: true
    },
    note: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    performed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    notification_id: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}, {
    tableName: 'plant_care_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        {
            name: 'idx_plant_care_log_user_time',
            fields: ['user_id', { name: 'performed_at', order: 'DESC' }]
        },
        {
            name: 'idx_plant_care_log_plant_time',
            fields: ['plant_id', { name: 'performed_at', order: 'DESC' }]
        }
    ]
})

export default PlantCareLog
