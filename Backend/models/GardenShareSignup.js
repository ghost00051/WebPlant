import sequelize from '../db.js'
import { DataTypes } from 'sequelize'

const GardenShareSignup = sequelize.define('garden_share_signup', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    share_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'garden_shares',
            key: 'id'
        },
        onDelete: 'CASCADE'
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onDelete: 'CASCADE'
    }
}, {
    tableName: 'garden_share_signups',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
        { name: 'idx_garden_share_signups_share', fields: ['share_id'] },
        { name: 'idx_garden_share_signups_created', fields: ['created_at'] },
        { name: 'idx_garden_share_signups_user_unique', unique: true, fields: ['user_id'] }
    ]
})

export default GardenShareSignup
