import Plus from '../../../img/plus-circle.svg'
import Message from '../../../img/message-circle.svg'
import Home from '../../../img/home.svg'
import User from '../../../img/user.svg'

export const TABS = [
    { id: 'home', icon: Home, label: 'Главная' },
    { id: 'add', icon: Plus, label: 'Добавить' },
    { id: 'chat', icon: Message, label: 'Чат с ИИ' },
    { id: 'profile', icon: User, label: 'Профиль' }
]

export const MOBILE_NAV_TABS = TABS.filter(tab => tab.id !== 'add')

export const ADD_TAB = TABS.find(tab => tab.id === 'add')
