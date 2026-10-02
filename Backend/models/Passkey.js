import sequelize from '../db.js'
import { DataTypes } from 'sequelize'
import User from './userModels.js'

const Passkey = sequelize.define('passkey', {
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
    credential_id: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    public_key: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    counter: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    transports: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
    },
    device_name: {
        type: DataTypes.STRING(120),
        allowNull: true
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    last_used_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'passkeys',
    timestamps: false,
    indexes: [
        { name: 'idx_passkeys_user_id', fields: ['user_id'] },
        { name: 'idx_passkeys_credential_id', unique: true, fields: ['credential_id'] }
    ]
})

User.hasMany(Passkey, { foreignKey: 'user_id', as: 'passkeys' })
Passkey.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default Passkey