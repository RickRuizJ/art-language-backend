// backend/src/controllers/uploadController.js

exports.uploadWorksheet = async (req, res) => {
  try {
    return res.status(501).json({
      success: false,
      message: 'Upload endpoint not implemented yet'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
};

exports.saveGoogleLink = async (req, res) => {
  try {
    return res.status(501).json({
      success: false,
      message: 'Google link endpoint not implemented yet'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
};

exports.getWorksheetFile = async (req, res) => {
  try {
    return res.status(404).json({
      success: false,
      message: 'File not found'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
};
