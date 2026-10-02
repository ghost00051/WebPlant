import WateringLog from './WateringLog.js'
import User from './userModels.js'
import Plant from './Plant.js'
import PlantPhoto from './PlantPhoto.js'
import ChatLog from './ChatLog.js'
import './Passkey.js'
import './PasskeyChallenge.js'

User.hasMany(Plant, {
    foreignKey: 'user_id',
    as: 'plants',
    onDelete: 'CASCADE'
})

User.hasMany(ChatLog, { foreignKey: 'user_id', onDelete: 'CASCADE' })
ChatLog.belongsTo(User, { foreignKey: 'user_id' })

Plant.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
})

Plant.hasMany(PlantPhoto, {
    foreignKey: 'plant_id',
    as: 'photos',
    onDelete: 'CASCADE'
})
PlantPhoto.belongsTo(Plant, {
    foreignKey: 'plant_id',
    as: 'plant'
})

Plant.hasMany(WateringLog, { foreignKey: 'plant_id', as: 'wateringLogs', onDelete: 'CASCADE' })
WateringLog.belongsTo(Plant, { foreignKey: 'plant_id', as: 'plant' })

User.hasMany(WateringLog, { foreignKey: 'user_id', onDelete: 'CASCADE' })
WateringLog.belongsTo(User, { foreignKey: 'user_id' })

export { User, Plant, PlantPhoto }