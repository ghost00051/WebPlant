function ContentTable({ table, withCaption = true }) {
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
        return null
    }

    return (
        <div className='contentTableWrap'>
            <table className='contentTable'>
                {withCaption && table.caption && <caption>{table.caption}</caption>}
                <thead>
                    <tr>
                        {table.columns.map(column => (
                            <th key={column} scope='col'>{column}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {table.rows.map((row, rowIndex) => (
                        <tr key={`${rowIndex}-${row[0] ?? ''}`}>
                            {row.map((cell, cellIndex) => (
                                cellIndex === 0
                                    ? <th key={cellIndex} scope='row'>{cell}</th>
                                    : <td key={cellIndex}>{cell}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

export default ContentTable
