import sequelize from '../db.js'
import { DataTypes } from 'sequelize'
import User from './userModels.js'

const PasskeyChallenge = sequelize.define('passkey_challenge', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
    },
    challenge: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
    },
    type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['registration', 'authentication']] }
    },
    key: {
        type: DataTypes.STRING(120),
        allowNull: false
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'passkey_challenges',
    timestamps: false,
    indexes: [
        { name: 'idx_passkey_challenges_key', fields: ['key'] },
        { name: 'idx_passkey_challenges_expires', fields: ['expires_at'] }
    ]
})

PasskeyChallenge.belongsTo(User, { foreignKey: 'user_id', as: 'user' })

export default PasskeyChallenge