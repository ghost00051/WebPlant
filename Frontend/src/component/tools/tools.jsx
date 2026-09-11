import React from 'react'
import Tree from '../../../img/Tree.svg'
import Calender from '../../../img/Calender.svg'
import Human from '../../../img/Human.svg'
import Chat from '../../../img/Chat.svg'
import '../tools/tools.css'

function Tools () {
  return (
    <div className='blocksOftools'>
      <div className='toolsSelect'>
        <div>
          <img src={Tree} alt='Добавить растение' />
          <p>Добавить растение</p>
        </div>
        <div>
          <img src={Calender} alt='Календарь' />
          <p>Календарь</p>
        </div>
        <div>
          <img src={Chat} alt='Чат' />
          <p>Чат</p>
        </div>
        <div>
          <img src={Human} alt='Человек' />
          <p>Личный кабинет</p>
        </div>
      </div>
    </div>
  )
}

export default Tools
