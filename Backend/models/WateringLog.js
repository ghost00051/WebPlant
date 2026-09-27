import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const WateringLog = sequelize.define("watering_log", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    plant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'plants', key: 'id' },
        onDelete: 'CASCADE'
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
    },

    action: {
        type: DataTypes.ENUM('watered', 'skipped'),
        allowNull: false
    },

    action_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },

    scheduled_for: {
        type: DataTypes.DATE,
        allowNull: true
    },

    hours_late: {
        type: DataTypes.INTEGER,
        allowNull: true
    },

    note: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}, {
    tableName: 'watering_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        { name: 'idx_watering_log_plant', fields: ['plant_id', 'action_at'] },
        { name: 'idx_watering_log_user', fields: ['user_id', 'action_at'] }
    ]
})

export default WateringLog