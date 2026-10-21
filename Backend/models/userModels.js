import sequelize from "../db.js"
import { DataTypes } from "sequelize"

const User = sequelize.define("user", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    email: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    username: {
        type: DataTypes.STRING(30),
        allowNull: true,
        unique: true
    },
    phone: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    bio: {
        type: DataTypes.STRING(300),
        allowNull: true
    },
    role: {
        type: DataTypes.ENUM("USER", "ADMIN"),
        defaultValue: "USER"
    },
    privilege_level: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "free"
    },
    welcome_email_sent_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    timezone: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'IANA-пояс пользователя: в нём считаются время полива и сутки календаря'
    },
    marketing_email_opt_in: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Отдельное необязательное согласие на маркетинговые письма (L2.1, B19.6)'
    },
    marketing_email_opt_in_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Когда пользователь дал согласие на маркетинговые письма'
    },
    marketing_email_opt_in_source: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: 'Источник согласия: registration / settings / import'
    },
    marketing_email_opt_out_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Когда согласие отозвано (one-click отписка или настройки)'
    }
}, {
    tableName: 'users',
    timestamps: false,
    indexes: [
        {
            name: 'idx_users_username_unique',
            unique: true,
            fields: ['username']
        },
        {
            name: 'idx_users_marketing_email_opt_in',
            fields: ['marketing_email_opt_in'],
            where: { marketing_email_opt_in: true }
        }
    ]
})

export default User