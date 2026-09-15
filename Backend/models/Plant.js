import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const Plant = sequelize.define("plant", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    species: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    location: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    photo_url: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    watering_interval_days: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 7
    },
    last_watered_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    next_watering_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {}
    }
}, {
    tableName: 'plants',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { name: 'idx_plants_user', fields: ['user_id'] },
        { name: 'idx_plants_active', fields: ['user_id', 'is_active'] }
    ]
})

export default Plant