import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const GardenShare = sequelize.define('garden_share', {
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
    token: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true
    },
    revoked_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    view_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    last_viewed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    views_notified_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'F50: когда владельцу последний раз сообщали о просмотрах'
    },
    views_notified_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'F50: view_count на момент последнего уведомления'
    }
}, {
    tableName: 'garden_shares',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        {
            name: 'idx_garden_shares_active_user',
            unique: true,
            fields: ['user_id'],
            where: { revoked_at: null }
        }
    ]
})

export default GardenShare
