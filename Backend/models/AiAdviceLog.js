import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const AiAdviceLog = sequelize.define('ai_advice_log', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
    },
    kind: {
        type: DataTypes.ENUM('species', 'watering', 'time', 'care'),
        allowNull: false
    },
    plant_name: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    species: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    season: {
        type: DataTypes.STRING(16),
        allowNull: true
    },
    result_type: {
        type: DataTypes.STRING(16),
        allowNull: true
    },
    interval_days: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    time_of_day: {
        type: DataTypes.STRING(16),
        allowNull: true
    },
    confidence: {
        type: DataTypes.STRING(16),
        allowNull: true
    },
    questions_asked: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    source: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'ai'
    },
    latency_ms: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    tableName: 'ai_advice_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
})

export default AiAdviceLog
