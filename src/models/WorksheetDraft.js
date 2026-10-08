const {DataTypes}=require('sequelize');
const sequelize=require('../config/database');
module.exports=sequelize.define('WorksheetDraft',{
 worksheetId:{type:DataTypes.UUID,primaryKey:true,field:'worksheet_id'},
 studentId:{type:DataTypes.UUID,primaryKey:true,field:'student_id'},
 attemptToken:{type:DataTypes.UUID,allowNull:false,field:'attempt_token'},
 layoutRevision:{type:DataTypes.INTEGER,allowNull:false,field:'layout_revision'},
 startedAt:{type:DataTypes.DATE,allowNull:false,field:'started_at'},
 answers:{type:DataTypes.JSONB,defaultValue:[]},
 updatedAt:{type:DataTypes.DATE,field:'updated_at'}
},{tableName:'worksheet_drafts',timestamps:false});
